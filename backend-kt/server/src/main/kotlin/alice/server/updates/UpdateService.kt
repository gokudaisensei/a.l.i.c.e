package alice.server.updates

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.server.backups.BackupService
import alice.server.backups.BackupView
import alice.server.notifications.NewNotification
import alice.server.notifications.NotificationsService
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZoneId

@Serializable
data class UpdateSettings(
    val autoUpdate: Boolean = false,
    val windowStart: String = "02:00",
    val windowEnd: String = "04:00",
)

@Serializable
data class UpdateView(
    val id: String,
    val fromVersion: String,
    val version: String,
    val status: String,
    val trigger: String,
    val reason: String? = null,
    val backupId: String? = null,
    val haBackupId: String? = null,
    val scheduledFor: Long? = null,
    val error: String? = null,
    val createdAt: Long,
    val startedAt: Long? = null,
    val finishedAt: Long? = null,
)

@Serializable
data class UpdateStatus(
    val currentVersion: String,
    val state: String,
    val available: AvailableUpdate? = null,
    val installable: Boolean,
    val settings: UpdateSettings,
    val inWindow: Boolean,
    val nextWindowAt: Long,
    val checkedAt: Long? = null,
    val checkError: String? = null,
    val active: UpdateView? = null,
)

private val HHMM = Regex("""^([01]\d|2[0-3]):[0-5]\d$""")
private fun toMin(hhmm: String): Int {
    val p = hhmm.split(":")
    return (p.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0)
}
fun inWindow(minutes: Int, start: String, end: String): Boolean {
    val s = toMin(start); val e = toMin(end)
    return if (s == e) false else if (s < e) minutes in s until e else minutes >= s || minutes < e
}
fun localMinutes(nowMs: Long, tz: String): Int {
    val zone = runCatching { ZoneId.of(tz) }.getOrDefault(ZoneId.of("UTC"))
    val t = Instant.ofEpochMilli(nowMs).atZone(zone)
    return t.hour * 60 + t.minute
}

class UpdateService(
    private val db: Database,
    private val backups: BackupService,
    private val notifications: NotificationsService,
    private val time: TimeProvider,
    private val currentVersionValue: String,
    private val source: UpdateSource,
    private val installer: UpdateInstaller,
    private val allowUnsigned: Boolean = false,
    private val installTimeoutMs: Long = 30 * 60_000,
    private val haBackupWaitMs: Long = 10 * 60_000,
    private val checkEveryMs: Long = 6 * 3_600_000,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true },
) {
    private val tickMutex = Mutex()

    fun currentVersion(): String = currentVersionValue

    private fun now() = time.now()

    private data class Stored(
        val settings: UpdateSettings = UpdateSettings(),
        val latest: AvailableUpdate? = null,
        val checkedAt: Long? = null,
        val checkError: String? = null,
        val notifiedVersion: String? = null,
    )

    private fun parseSettings(obj: JsonObject?): UpdateSettings {
        if (obj == null) return UpdateSettings()
        fun s(k: String, d: String) = (obj[k] as? JsonPrimitive)?.contentOrNull ?: d
        fun b(k: String, d: Boolean) = (obj[k] as? JsonPrimitive)?.booleanOrNull ?: d
        return UpdateSettings(
            autoUpdate = b("autoUpdate", false),
            windowStart = s("windowStart", "02:00"),
            windowEnd = s("windowEnd", "04:00"),
        )
    }

    private fun stored(householdId: String): Stored {
        val row = db.read { identityQueries.selectHouseholdSettings(householdId).executeAsOneOrNull() } ?: return Stored()
        val root = runCatching { row.settings?.let { json.parseToJsonElement(it).jsonObject } }.getOrNull() ?: return Stored()
        val u = root["updates"] as? JsonObject ?: return Stored()
        val latest = runCatching { u["latest"]?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.let { json.decodeFromJsonElement(AvailableUpdate.serializer(), it) } }.getOrNull()
        return Stored(
            settings = parseSettings(u["settings"] as? JsonObject),
            latest = latest,
            checkedAt = (u["checkedAt"] as? JsonPrimitive)?.longOrNull,
            checkError = (u["checkError"] as? JsonPrimitive)?.contentOrNull,
            notifiedVersion = (u["notifiedVersion"] as? JsonPrimitive)?.contentOrNull,
        )
    }

    private fun patchStored(householdId: String, mutate: (Stored) -> Stored) {
        db.write {
            val row = identityQueries.selectHouseholdSettings(householdId).executeAsOneOrNull()
            val root = runCatching { row?.settings?.let { json.parseToJsonElement(it).jsonObject } }.getOrNull()?.toMutableMap() ?: mutableMapOf()
            val cur = stored(householdId)
            val next = mutate(cur)
            val updatesObj = buildJsonObject {
                put("settings", json.encodeToJsonElement(UpdateSettings.serializer(), next.settings))
                if (next.latest != null) put("latest", json.encodeToJsonElement(AvailableUpdate.serializer(), next.latest)) else put("latest", kotlinx.serialization.json.JsonNull)
                if (next.checkedAt != null) put("checkedAt", JsonPrimitive(next.checkedAt)) else put("checkedAt", kotlinx.serialization.json.JsonNull)
                if (next.checkError != null) put("checkError", JsonPrimitive(next.checkError)) else put("checkError", kotlinx.serialization.json.JsonNull)
                if (next.notifiedVersion != null) put("notifiedVersion", JsonPrimitive(next.notifiedVersion)) else put("notifiedVersion", kotlinx.serialization.json.JsonNull)
            }
            root["updates"] = updatesObj
            val merged = JsonObject(root)
            val settingsStr = json.encodeToString(JsonObject.serializer(), merged)
            if (row == null) {
                // ensure settings row exists then set
                runCatching { identityQueries.insertHouseholdSettings(householdId) }
            }
            identityQueries.updateHouseholdSettingsSettings(settingsStr, householdId)
        }
    }

    fun settings(householdId: String): UpdateSettings = stored(householdId).settings

    fun updateSettings(householdId: String, userId: String, patch: UpdateSettingsPatch): UpdateSettings {
        val cur = settings(householdId)
        val s = cur.copy(
            autoUpdate = patch.autoUpdate ?: cur.autoUpdate,
            windowStart = patch.windowStart ?: cur.windowStart,
            windowEnd = patch.windowEnd ?: cur.windowEnd,
        )
        if (!HHMM.matches(s.windowStart) || !HHMM.matches(s.windowEnd)) throw AppException("validation_error", "Times must look like 02:00", 400)
        if (s.windowStart == s.windowEnd) throw AppException("validation_error", "The update window cannot be empty", 400)
        patchStored(householdId) { it.copy(settings = s) }
        Audit.write(db, "update.settings", householdId, userId, "user", null, buildJsonObject {
            put("autoUpdate", s.autoUpdate); put("windowStart", s.windowStart); put("windowEnd", s.windowEnd)
        }, now())
        return s
    }

    @Serializable data class UpdateSettingsPatch(val autoUpdate: Boolean? = null, val windowStart: String? = null, val windowEnd: String? = null)

    private fun tz(householdId: String): String =
        db.read { identityQueries.selectHouseholdById(householdId).executeAsOneOrNull()?.timezone } ?: "UTC"

    private fun inWindowNow(householdId: String): Boolean {
        val s = settings(householdId)
        return inWindow(localMinutes(now(), tz(householdId)), s.windowStart, s.windowEnd)
    }

    fun nextWindowStart(householdId: String): Long {
        if (inWindowNow(householdId)) return now()
        val s = settings(householdId)
        val curMin = localMinutes(now(), tz(householdId))
        val delta = (toMin(s.windowStart) - curMin + 1440) % 1440
        return (now() / 60_000) * 60_000 + delta * 60_000L
    }

    private fun rowToView(r: alice.core.db.Update_records): UpdateView = UpdateView(
        id = r.id, fromVersion = r.from_version, version = r.version, status = r.status, trigger = r.trigger_kind,
        reason = r.reason, backupId = r.backup_id, haBackupId = r.ha_backup_id, scheduledFor = r.scheduled_for,
        error = r.error, createdAt = r.created_at, startedAt = r.started_at, finishedAt = r.finished_at,
    )

    private fun activeRow(householdId: String) = db.read { coreQueries.selectActiveUpdateRecord(householdId).executeAsOneOrNull() }

    fun status(householdId: String): UpdateStatus {
        val st = stored(householdId)
        val available = st.latest?.takeIf { isNewer(it.version, currentVersionValue) }
        val act = activeRow(householdId)
        val state = when {
            act != null -> act.status
            available != null -> "ready"
            else -> "up_to_date"
        }
        val installable = available != null && (available.signed || allowUnsigned)
        return UpdateStatus(
            currentVersion = currentVersionValue,
            state = state,
            available = available,
            installable = installable,
            settings = settings(householdId),
            inWindow = inWindowNow(householdId),
            nextWindowAt = nextWindowStart(householdId),
            checkedAt = st.checkedAt,
            checkError = st.checkError,
            active = act?.let { rowToView(it) },
        )
    }

    fun history(householdId: String): List<UpdateView> =
        db.read { coreQueries.selectUpdateRecordsByHousehold(householdId, 50).executeAsList().map { rowToView(it) } }

    fun lastFailed(householdId: String): UpdateView? {
        val r = db.read { coreQueries.selectLastUpdateRecordByHousehold(householdId).executeAsOneOrNull() } ?: return null
        return if (r.status == "failed") rowToView(r) else null
    }

    suspend fun check(householdId: String): UpdateStatus {
        try {
            val latest = source.latest()
            patchStored(householdId) { it.copy(latest = latest, checkedAt = now(), checkError = null) }
            if (latest != null && isNewer(latest.version, currentVersionValue) && stored(householdId).notifiedVersion != latest.version) {
                patchStored(householdId) { it.copy(notifiedVersion = latest.version) }
                notifications.notifyAdmins(householdId, NewNotification(
                    kind = "update_available",
                    title = "Alice ${latest.version} is available",
                    body = if (settings(householdId).autoUpdate) "It will install tonight." else "Schedule it for tonight's window, or install it from Updates.",
                ))
            }
        } catch (e: Throwable) {
            patchStored(householdId) { it.copy(checkedAt = now(), checkError = (e.message ?: "Could not check").take(200)) }
        }
        return status(householdId)
    }

    private fun createRecord(householdId: String, trigger: String, userId: String?, reason: String?, scheduledFor: Long?): alice.core.db.Update_records {
        val available = status(householdId).available ?: throw AppException("no_update", "There is no newer version to install", 409)
        if (!available.signed && !allowUnsigned) throw AppException("unsigned_update", "This update is not signed by the publisher key, so Alice will not install it", 409)
        if (activeRow(householdId) != null) throw AppException("update_in_progress", "An update is already scheduled or installing", 409)
        val id = Ids.next("upd")
        val t = now()
        db.write {
            coreQueries.insertUpdateRecord(
                id, householdId, currentVersionValue, available.version, "scheduled", trigger, reason, userId,
                scheduledFor, null, null, null, t, null, null,
            )
        }
        val action = when (trigger) {
            "auto" -> "update.auto_scheduled"
            "emergency" -> "update.emergency"
            else -> "update.requested"
        }
        Audit.write(db, action, householdId, userId, if (userId != null) "user" else "system", id, buildJsonObject {
            put("from", currentVersionValue); put("to", available.version); if (reason != null) put("reason", reason)
        }, t)
        return db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() }
    }

    fun schedule(householdId: String, userId: String): UpdateView = rowToView(createRecord(householdId, "manual", userId, null, nextWindowStart(householdId)))

    suspend fun installNow(householdId: String, userId: String): UpdateView {
        if (!inWindowNow(householdId)) throw AppException("outside_window", "Updates install between the set hours. Schedule it, or use an emergency deploy", 409)
        val r = createRecord(householdId, "manual", userId, null, now())
        return start(r.id, householdId)
    }

    suspend fun emergency(householdId: String, userId: String, reason: String, confirm: String): UpdateView {
        val why = reason.trim()
        if (why.length < 8) throw AppException("reason_required", "Give a reason of at least 8 characters", 400)
        if (confirm != "DEPLOY") throw AppException("confirmation_required", "Type DEPLOY to confirm", 400)
        val r = createRecord(householdId, "emergency", userId, why.take(300), now())
        notifications.notifyAdmins(householdId, NewNotification(
            kind = "update_emergency",
            title = "Emergency update started",
            body = "Alice is updating outside the usual window: ${why.take(150)}",
            urgent = true,
        ))
        return start(r.id, householdId)
    }

    fun cancel(householdId: String, userId: String, id: String): UpdateView {
        val r = db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOneOrNull() } ?: throw notFound("Update")
        if (r.status != "scheduled") throw AppException("not_cancellable", "Only a scheduled update can be cancelled", 409)
        db.write { coreQueries.updateUpdateRecordStatus("cancelled", null, now(), id) }
        Audit.write(db, "update.cancelled", householdId, userId, "user", id, null, now())
        return rowToView(db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() })
    }

    private fun fail(id: String, householdId: String, message: String): UpdateView {
        val r = db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOneOrNull() }
        db.write { coreQueries.updateUpdateRecordStatus("failed", message.take(300), now(), id) }
        if (r != null) {
            Audit.write(db, "update.failed", householdId, r.requested_by, if (r.requested_by != null) "user" else "system", id, buildJsonObject {
                put("to", r.version); put("error", message.take(300))
            }, now())
            notifications.notifyAdmins(householdId, NewNotification(
                kind = "update_failed",
                title = "The update did not go through",
                body = message.take(200),
                urgent = true,
            ))
        }
        return rowToView(db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() })
    }

    private suspend fun start(id: String, householdId: String): UpdateView {
        val r = db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() }
        db.write { coreQueries.updateUpdateRecordStart("preparing", now(), null, id) }
        val b = backups.createApp(householdId, "manual", r.requested_by)
        if (b.status != "ok") return fail(id, householdId, "The safety backup failed, so nothing was changed: ${b.error ?: "unknown error"}")
        db.write { coreQueries.updateUpdateRecordBackup(b.id, id) }
        val haOk = runCatching { backups.haAvailable(householdId) }.getOrDefault(false)
        if (haOk) {
            try {
                val ha = backups.createHa(householdId, "manual", r.requested_by)
                db.write { coreQueries.updateUpdateRecordHaBackup(ha.id, id) }
                if (r.trigger_kind != "emergency") {
                    // wait for HA backup completion via tick, unless emergency
                    return rowToView(db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() })
                }
            } catch (_: Throwable) { /* best effort */ }
        }
        return finish(id, householdId)
    }

    private suspend fun finish(id: String, householdId: String): UpdateView {
        val r = db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() }
        db.write { coreQueries.updateUpdateRecordStatus("installing", null, null, id) }
        try {
            val sha = stored(householdId).latest?.artifactSha256
            installer.request(r.version, "install", sha)
        } catch (e: Throwable) {
            return fail(id, householdId, "The update could not be requested: ${e.message ?: "unknown error"}")
        }
        Audit.write(db, "update.installing", householdId, r.requested_by, if (r.requested_by != null) "user" else "system", id, buildJsonObject {
            put("to", r.version); r.backup_id?.let { put("backupId", it) }; r.ha_backup_id?.let { put("haBackupId", it) }
        }, now())
        return rowToView(db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() })
    }

    @Serializable
    data class RollbackResult(
        val rolledBack: Boolean,
        val toVersion: String,
        val dataRestoreStaged: Boolean,
        val homeAssistantBackupId: String?,
        val update: UpdateView,
    )

    suspend fun rollback(householdId: String, userId: String, id: String, restoreData: Boolean): RollbackResult {
        val r = db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOneOrNull() } ?: throw notFound("Update")
        if (r.status !in setOf("failed", "done", "installing") || r.started_at == null) throw AppException("not_rollbackable", "Only an update that was started can be rolled back", 409)
        if (restoreData && r.backup_id == null) throw AppException("no_backup", "This update has no safety backup to restore", 409)
        if (restoreData) backups.stageRestore(householdId, r.backup_id!!, userId)
        try {
            installer.request(r.from_version, "rollback", null)
        } catch (e: Throwable) {
            throw AppException("rollback_failed", "The rollback could not be requested: ${e.message ?: "unknown error"}", 502)
        }
        db.write { coreQueries.updateUpdateRecordStatus("rolled_back", null, now(), id) }
        Audit.write(db, "update.rolled_back", householdId, userId, "user", id, buildJsonObject {
            put("to", r.from_version); put("restoreData", restoreData)
        }, now())
        notifications.notifyAdmins(householdId, NewNotification(
            kind = "update_rolled_back",
            title = "Rolling back to ${r.from_version}",
            body = if (restoreData) "Restart Alice to finish; data since the update is replaced by the safety backup." else "Alice will go back to the previous version.",
        ))
        val out = rowToView(db.read { coreQueries.selectUpdateRecordById(id, householdId).executeAsOne() })
        return RollbackResult(
            rolledBack = true,
            toVersion = r.from_version,
            dataRestoreStaged = restoreData,
            homeAssistantBackupId = r.ha_backup_id,
            update = out,
        )
    }

    private fun triedBefore(householdId: String, version: String): Boolean =
        db.read { coreQueries.selectTriedUpdateForVersion(householdId, version).executeAsOneOrNull() } != null

    private suspend fun failTimedOut(act: alice.core.db.Update_records) {
        try {
            installer.request(act.from_version, "rollback", null)
            fail(act.id, act.household_id, "The server did not come back as the new version in time; a return to ${act.from_version} was requested")
        } catch (_: Throwable) {
            fail(act.id, act.household_id, "The server did not come back as the new version in time, and the return to the old version could not be requested")
        }
    }

    suspend fun tick() {
        if (!tickMutex.tryLock()) return
        try {
            val households = db.read { identityQueries.selectAllHouseholds().executeAsList() }
            for (h in households) {
                val act = activeRow(h.id)
                if (act != null && act.status == "preparing") {
                    val haId = act.ha_backup_id
                    if (haId == null) {
                        finish(act.id, h.id)
                    } else {
                        val ha = runCatching { backups.get(h.id, haId) }.getOrNull()
                        if (ha == null || ha.status == "ok") finish(act.id, h.id)
                        else if (ha.status == "failed") fail(act.id, h.id, "Home Assistant's safety backup failed, so nothing was changed: ${ha.error ?: "unknown error"}")
                        else if (now() - (act.started_at ?: act.created_at) > haBackupWaitMs) fail(act.id, h.id, "Home Assistant's safety backup did not finish in time, so nothing was changed")
                    }
                    continue
                }
                if (act != null && act.status == "installing") {
                    if (!isNewer(act.version, currentVersionValue)) {
                        db.write { coreQueries.updateUpdateRecordStatus("done", null, now(), act.id) }
                        Audit.write(db, "update.done", h.id, null, "system", act.id, buildJsonObject {
                            put("from", act.from_version); put("to", currentVersionValue)
                        }, now())
                        notifications.notifyAdmins(h.id, NewNotification(
                            kind = "update_done",
                            title = "Alice is now $currentVersionValue",
                            body = "The update finished.",
                        ))
                    } else if (now() - (act.started_at ?: act.created_at) > installTimeoutMs) {
                        failTimedOut(act)
                    }
                    continue
                }
                val st = stored(h.id)
                if (st.checkedAt == null || now() - st.checkedAt > checkEveryMs) {
                    runCatching { check(h.id) }
                }
                val s = settings(h.id)
                val curAct = activeRow(h.id)
                if (curAct != null && curAct.status == "scheduled") {
                    if ((curAct.scheduled_for ?: 0) <= now() && inWindowNow(h.id)) {
                        runCatching { start(curAct.id, h.id) }
                    }
                } else if (s.autoUpdate) {
                    val st2 = status(h.id)
                    val avail = st2.available
                    if (st2.installable && avail != null && inWindowNow(h.id) && !triedBefore(h.id, avail.version)) {
                        val rec = createRecord(h.id, "auto", null, null, now())
                        runCatching { start(rec.id, h.id) }
                    }
                }
            }
        } finally {
            tickMutex.unlock()
        }
    }
}
