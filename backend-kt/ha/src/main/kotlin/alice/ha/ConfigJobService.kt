package alice.ha

import alice.core.db.Database
import alice.core.ids.Ids
import alice.core.time.SystemTimeProvider
import alice.core.time.TimeProvider
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.atomic.AtomicBoolean

data class ConfigJob(
    val id: String,
    val connectionId: String,
    val operation: String,
    val payload: String,
    val status: String,
    val result: String?,
    val error: String?,
    val dedupeKey: String?,
    val completedAt: Long?,
)

class ConfigJobService(
    private val database: Database,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val time: TimeProvider = SystemTimeProvider,
) {
    private val handlers = mutableListOf<Pair<String, (ConfigJob) -> Unit>>()
    @Volatile private var schedulerStarted = false
    private val stopScheduler = AtomicBoolean(false)

    fun onResult(prefix: String, fn: (ConfigJob) -> Unit) { handlers += prefix to fn }

    fun connectionIdFor(householdId: String): String? {
        return database.read {
            identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull()?.id
        }
    }

    fun status(householdId: String): ConfigJobStatus {
        val conn = database.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
        val pending = if (conn != null) {
            database.read { identityQueries.selectPendingConfigJobs(conn.id).executeAsList().size }
        } else 0
        val failed = if (conn != null) {
            database.read { identityQueries.selectFailedConfigJobs(conn.id).executeAsList().size }
        } else 0
        val worker = database.read { identityQueries.selectConfigWorkerHeartbeat("config-worker").executeAsOneOrNull() }
        val lastSeen = worker?.last_seen_at
        val workerOnline = lastSeen != null && (time.now() - lastSeen) < 15_000
        return ConfigJobStatus(
            connected = conn != null,
            adminTokenSet = conn?.admin_token_enc != null,
            workerLastSeenAt = lastSeen,
            workerOnline = workerOnline,
            pendingJobs = pending,
            failedJobs = failed,
        )
    }

    data class ConfigJobStatus(
        val connected: Boolean,
        val adminTokenSet: Boolean,
        val workerLastSeenAt: Long? = null,
        val workerOnline: Boolean = false,
        val pendingJobs: Int,
        val failedJobs: Int,
    )

    fun enqueue(householdId: String, operation: String, payloadJson: String, dedupeKey: String? = null, requestedBy: String? = null): String? {
        val connectionId = connectionIdFor(householdId) ?: return null
        val id = Ids.next("cfg")
        val t = time.now()
        database.write {
            if (dedupeKey != null) identityQueries.deleteConfigJobsByDedupeKey(householdId, dedupeKey)
            identityQueries.insertConfigJob(id, householdId, connectionId, operation, payloadJson, dedupeKey, t, requestedBy, t)
        }
        return id
    }

    fun get(id: String): ConfigJob? {
        val row = database.read { identityQueries.selectConfigJobById(id).executeAsOneOrNull() } ?: return null
        return ConfigJob(row.id, row.connection_id, row.operation, row.payload, row.status, row.result, row.error, row.dedupe_key, row.completed_at)
    }

    /** Applies finished but unapplied job results to domain sync state, then marks applied. */
    fun applyResults(): Int {
        val rows = database.read { identityQueries.selectUnappliedConfigJobs().executeAsList() }
        for (r in rows) {
            val job = ConfigJob(r.id, r.connection_id, r.operation, r.payload, r.status, r.result, r.error, r.dedupe_key, r.completed_at)
            runCatching { postApply(job) }
            for ((prefix, fn) in handlers) if (job.operation.startsWith(prefix)) runCatching { fn(job) }
            database.write {
                identityQueries.updateConfigJobStatus(job.status, r.started_at, r.completed_at, job.result, job.error, time.now(), job.id)
            }
        }
        return rows.size
    }

    fun prune(keepDays: Int = 7): Int {
        val cutoff = time.now() - keepDays * 86_400_000L
        return runCatching {
            database.write { identityQueries.deleteOldConfigJobs(cutoff) }
            0 // SQLDelight exec delete count not trivially available; best-effort
        }.getOrDefault(0)
    }

    fun startScheduler(intervalMs: Long = 500) {
        if (schedulerStarted) return
        schedulerStarted = true
        stopScheduler.set(false)
        val t = Thread {
            while (!stopScheduler.get()) {
                runCatching { applyResults() }
                try { Thread.sleep(intervalMs.coerceAtLeast(100)) } catch (_: InterruptedException) { break }
            }
        }
        t.isDaemon = true
        t.name = "alice-config-job-apply"
        t.start()
    }

    fun stopScheduler() { stopScheduler.set(true) }

    private fun postApply(job: ConfigJob) {
        val payload = runCatching { json.parseToJsonElement(job.payload).jsonObject }.getOrNull()
        val now = time.now()
        val householdId = database.read { identityQueries.selectConfigJobById(job.id).executeAsOneOrNull()?.household_id }
            ?: return
        val error = job.error
        val ok = job.status == "done" && error == null

        if (job.operation == "voice.expose") {
            val ids = (payload?.get("entityIds") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
            for (eid in ids) {
                val current = database.read { identityQueries.selectEntitySettings(householdId, alice.ha.Connections.DEFAULT_ID, eid).executeAsOneOrNull() } ?: continue
                database.write {
                    identityQueries.upsertEntitySettings(
                        connection_id = alice.ha.Connections.DEFAULT_ID,
                        entity_id = eid,
                        household_id = householdId,
                        power_limit_w = current.power_limit_w,
                        left_open_after_ms = current.left_open_after_ms,
                        voice_exposed = current.voice_exposed,
                        voice_sync_status = if (ok) "synced" else "failed",
                        voice_sync_error = if (ok) null else (error ?: "Voice sync failed"),
                        updated_at = now,
                    )
                }
            }
        }
        if (job.operation == "script.upsert" || job.operation == "script.delete") {
            val objectId = payload?.get("objectId")?.let { (it as? JsonPrimitive)?.content } ?: return
            val scene = database.read { identityQueries.selectScenesByHousehold(householdId).executeAsList() }.firstOrNull {
                "alice_scene_${it.id.removePrefix("scn_").replace("-", "_")}" == objectId
            }
            if (scene != null) {
                val status = if (ok) "synced" else "failed"
                dbUpdateSceneSync(scene.id, householdId, status, if (ok) null else (error ?: "Sync failed"), if (ok) now else scene.synced_at, if (ok) (scene.ha_entity_id ?: "script.$objectId") else scene.ha_entity_id)
                return
            }
            val routine = database.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }.firstOrNull {
                "alice_routine_${it.id.removePrefix("rtn_").replace("-", "_")}" == objectId
            }
            if (routine != null) {
                val status = if (ok) "synced" else "failed"
                dbUpdateRoutineSync(routine.id, householdId, status, if (ok) null else (error ?: "Sync failed"), if (ok) now else routine.synced_at, if (ok) (routine.ha_entity_id ?: "script.$objectId") else routine.ha_entity_id)
            }
        }
        if (job.operation == "automation.upsert" || job.operation == "automation.delete" || job.operation == "automation.set_enabled") {
            val cid = payload?.get("id")?.let { (it as? JsonPrimitive)?.content }
                ?: payload?.get("configId")?.let { (it as? JsonPrimitive)?.content }
                ?: return
            val atm = database.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }.firstOrNull {
                "alice_auto_${it.id.removePrefix("atm_").replace("-", "_")}" == cid
            } ?: return
            val status = if (ok) "synced" else "failed"
            val entityId = runCatching { json.parseToJsonElement(job.result ?: "{}").jsonObject["entityId"]?.jsonPrimitive?.content }.getOrNull()
                ?: atm.ha_entity_id ?: "automation.$cid"
            dbUpdateAutomationSync(atm.id, householdId, status, if (ok) null else (error ?: "Sync failed"), if (ok) now else atm.synced_at, entityId)
        }
        if (job.operation == "config.verify" && ok) {
            val drifted = runCatching { json.parseToJsonElement(job.result ?: "{}").jsonObject["drifted"]?.jsonArray }.getOrNull() ?: return
            for (d in drifted.mapNotNull { it as? JsonObject }) {
                val kind = d["kind"]?.jsonPrimitive?.content ?: continue
                val id = d["id"]?.jsonPrimitive?.content ?: continue
                val reason = d["reason"]?.jsonPrimitive?.content ?: "changed"
                val err = "Drift detected: $reason"
                when (kind) {
                    "script" -> {
                        val scene = database.read { identityQueries.selectScenesByHousehold(householdId).executeAsList() }.firstOrNull {
                            "alice_scene_${it.id.removePrefix("scn_").replace("-", "_")}" == id
                        }
                        if (scene != null) dbUpdateSceneSync(scene.id, householdId, "drifted", err, scene.synced_at, scene.ha_entity_id)
                        val routine = database.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }.firstOrNull {
                            "alice_routine_${it.id.removePrefix("rtn_").replace("-", "_")}" == id
                        }
                        if (routine != null) dbUpdateRoutineSync(routine.id, householdId, "drifted", err, routine.synced_at, routine.ha_entity_id)
                    }
                    "automation" -> {
                        val atm = database.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }.firstOrNull {
                            "alice_auto_${it.id.removePrefix("atm_").replace("-", "_")}" == id
                        }
                        if (atm != null) dbUpdateAutomationSync(atm.id, householdId, "drifted", err, atm.synced_at, atm.ha_entity_id)
                    }
                }
            }
        }
    }

    private fun dbUpdateSceneSync(id: String, householdId: String, status: String, error: String?, syncedAt: Long?, haEntityId: String?) {
        val scene = database.read { identityQueries.selectSceneById(id).executeAsOneOrNull() } ?: return
        database.write {
            identityQueries.updateScene(scene.name, scene.icon, scene.description, scene.actions, scene.updated_at, scene.last_run_at, status, error, syncedAt, haEntityId ?: scene.ha_entity_id, id)
        }
    }
    private fun dbUpdateRoutineSync(id: String, householdId: String, status: String, error: String?, syncedAt: Long?, haEntityId: String?) {
        val routine = database.read { identityQueries.selectRoutineById(id).executeAsOneOrNull() } ?: return
        database.write {
            identityQueries.updateRoutine(routine.name, routine.icon, routine.steps, routine.on_failure, routine.updated_at, routine.last_run_at, status, error, syncedAt, haEntityId ?: routine.ha_entity_id, id)
        }
    }
    private fun dbUpdateAutomationSync(id: String, householdId: String, status: String, error: String?, syncedAt: Long?, haEntityId: String?) {
        val atm = database.read { identityQueries.selectAutomationById(id).executeAsOneOrNull() } ?: return
        database.write {
            identityQueries.updateAutomation(atm.name, atm.definition, atm.enabled, status, error, syncedAt, haEntityId ?: atm.ha_entity_id, atm.compiled_hash, atm.last_triggered_at, atm.updated_at, id)
        }
    }
}
