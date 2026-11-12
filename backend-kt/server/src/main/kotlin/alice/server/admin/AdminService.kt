package alice.server.admin

import alice.core.config.AppConfig
import alice.core.db.Database
import alice.core.time.TimeProvider
import alice.ha.ConfigJobService
import alice.ha.HaConnectionState
import alice.ha.HomeAssistantGateway
import alice.server.ha.HaConnectionAdminService
import alice.server.households.HouseholdService
import alice.server.notifications.PushService
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File

@Serializable data class HealthCheck(val name: String, val status: String, val detail: String)
@Serializable data class AdminHealth(val status: String, val version: String, val uptimeSeconds: Long, val checks: List<HealthCheck>)
@Serializable data class AuditActor(val type: String, val id: String? = null, val name: String? = null)
@Serializable data class AuditItem(val id: String, val at: Long, val actor: AuditActor, val action: String, val resource: String? = null, val detail: kotlinx.serialization.json.JsonElement? = null)
@Serializable data class AuditPage(val items: List<AuditItem>, val nextCursor: String? = null)

class AdminService(
    private val db: Database,
    private val gateway: HomeAssistantGateway,
    private val things: ThingsService,
    private val jobs: ConfigJobService,
    private val push: PushService,
    private val households: HouseholdService,
    private val haAdmin: HaConnectionAdminService,
    private val config: AppConfig,
    private val time: TimeProvider,
) {
    private val startedAt = time.now()

    fun health(householdId: String): AdminHealth {
        val checks = mutableListOf<HealthCheck>()
        try { db.read { coreQueries.countAuditLog().executeAsOne() }; checks += HealthCheck("database", "ok", "Responding") } catch (_: Throwable) {
            checks += HealthCheck("database", "down", "The database did not answer")
        }

        val conn = haAdmin.status(householdId)
        if (!conn.configured) checks += HealthCheck("homeAssistant", "warn", "Home Assistant is not connected yet")
        else if (gateway.state == HaConnectionState.CONNECTED) checks += HealthCheck("homeAssistant", "ok", "Connected to Home Assistant ${conn.haVersion ?: ""}".trim())
        else checks += HealthCheck("homeAssistant", "down", conn.lastError?.let { "${conn.status ?: "disconnected"}: $it" } ?: (conn.status ?: "disconnected"))

        val s = jobs.status(householdId)
        if (!s.connected) checks += HealthCheck("configWorker", "ok", "Not needed until Home Assistant is connected")
        else if (!s.adminTokenSet) checks += HealthCheck("configWorker", "warn", "No admin token: scenes, routines and automations cannot be added to Home Assistant")
        else if (!s.workerOnline) checks += HealthCheck("configWorker", "warn", if (s.pendingJobs > 0) "The worker is not running and ${s.pendingJobs} change(s) are waiting" else "The worker is not running")
        else checks += HealthCheck("configWorker", "ok", if (s.pendingJobs > 0) "Running, ${s.pendingJobs} change(s) in progress" else "Running")
        if (s.failedJobs > 0) checks += HealthCheck("configJobs", "warn", "${s.failedJobs} change(s) could not be applied to Home Assistant")

        val platforms = push.platforms()
        checks += if (platforms.isNotEmpty()) HealthCheck("push", "ok", "Push is set up for ${platforms.joinToString(" and ")}") else HealthCheck("push", "warn", "Push notifications are not set up; notifications only appear in the app")

        val status = when {
            checks.any { it.status == "down" } -> "down"
            checks.any { it.status == "warn" } -> "warn"
            else -> "ok"
        }
        return AdminHealth(status, config.app.version, (time.now() - startedAt) / 1000, checks)
    }

    fun diagnostics(householdId: String): kotlinx.serialization.json.JsonObject {
        val conn = haAdmin.status(householdId)
        val dbBytes = runCatching {
            val p = config.database.path
            if (p == ":memory:") null else File(p).takeIf { it.exists() }?.length()
        }.getOrNull()
        val scenes = db.read { identityQueries.selectScenesByHousehold(householdId).executeAsList() }.size
        val routines = db.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }.size
        val automations = db.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }.size
        val members = households.listMembers(householdId)
        val memberCount = members.size
        val unread = runCatching {
            members.sumOf { m ->
                db.read { identityQueries.selectUnreadNotificationsCount(m.userId).executeAsOne().toInt() }
            }
        }.getOrDefault(0)
        val devices = alice.core.concurrent.runCatchingNonCancellation { kotlinx.coroutines.runBlocking { things.things(householdId, includeHidden = true) } }.getOrDefault(emptyList())
        fun jstr(v: String?) = if (v == null) JsonNull else JsonPrimitive(v)
        fun jlong(v: Long?) = if (v == null) JsonNull else JsonPrimitive(v)
        fun jint(v: Int?) = if (v == null) JsonNull else JsonPrimitive(v)
        return buildJsonObject {
            put("app", buildJsonObject {
                put("name", JsonPrimitive(config.app.name))
                put("version", JsonPrimitive(config.app.version))
                put("runtime", JsonPrimitive("jvm ${System.getProperty("java.version")}"))
                put("environment", JsonPrimitive(config.app.environment))
                put("startedAt", JsonPrimitive(startedAt))
            })
            put("features", buildJsonObject {
                put("pushChannels", buildJsonArray { push.platforms().forEach { add(JsonPrimitive(it)) } })
                put("adminTokenSealing", JsonPrimitive(config.adminSealPublicKey != null))
                put("operationalTokenEncryption", JsonPrimitive(false))
                put("trustProxy", JsonPrimitive(config.http.trustProxy))
                put("passkeyRelyingParty", JsonPrimitive(config.webauthn.rpId))
            })
            put("homeAssistant", buildJsonObject {
                put("configured", JsonPrimitive(conn.configured))
                put("version", jstr(conn.haVersion))
                put("status", jstr(if (gateway.state == HaConnectionState.CONNECTED) "connected" else conn.status))
                put("host", jstr(conn.baseUrl?.let { runCatching { java.net.URI(it).host }.getOrNull() }))
                put("entities", JsonPrimitive(conn.entities ?: 0))
                put("lastSyncAt", jstr(conn.syncedAt))
            })
            put("counts", buildJsonObject {
                put("members", JsonPrimitive(memberCount))
                put("devices", JsonPrimitive(devices.count { !it.hidden }))
                put("hiddenDevices", JsonPrimitive(devices.count { it.hidden }))
                put("scenes", JsonPrimitive(scenes))
                put("routines", JsonPrimitive(routines))
                put("automations", JsonPrimitive(automations))
                put("unreadNotifications", JsonPrimitive(unread))
            })
            put("database", buildJsonObject { put("sizeBytes", jlong(dbBytes)) })
        }
    }

    fun audit(householdId: String, limit: Int = 50, before: String? = null, action: String? = null): AuditPage {
        val lim = limit.coerceIn(1, 200)
        var cursorAt: Long? = null
        var cursorId: String? = null
        if (!before.isNullOrBlank()) {
            val parts = before.split(":", limit = 2)
            cursorAt = parts.getOrNull(0)?.toLongOrNull()
            cursorId = parts.getOrNull(1)
        }
        val actionPrefix = action?.replace("%", "")?.replace("_", "")?.takeIf { it.isNotBlank() }
        // One more row than the page, to know whether there is a next page.
        val rows = db.read { coreQueries.selectAuditPage(householdId, actionPrefix, cursorAt, cursorId ?: "", (lim + 1).toLong()).executeAsList() }
        val page = rows.take(lim)
        val next = if (rows.size > lim && page.isNotEmpty()) "${page.last().created_at}:${page.last().id}" else null
        val names = page.mapNotNull { it.actor_id }.distinct().associateWith { uid ->
            db.read { identityQueries.selectUserById(uid).executeAsOneOrNull() }?.display_name
        }
        val items = page.map { r ->
            val detail = r.detail?.let { runCatching { kotlinx.serialization.json.Json.parseToJsonElement(it) }.getOrNull() }
            AuditItem(r.id, r.created_at, AuditActor(r.actor_type, r.actor_id, r.actor_id?.let { names[it] }), r.action, r.resource, detail)
        }
        return AuditPage(items, next)
    }

    fun metrics(householdId: String): kotlinx.serialization.json.JsonObject {
        val now = time.now()
        val health = health(householdId)
        val devices = alice.core.concurrent.runCatchingNonCancellation { kotlinx.coroutines.runBlocking { things.things(householdId, includeHidden = true) } }.getOrDefault(emptyList())
        val auditCount = db.read { coreQueries.countAuditLog().executeAsOne() }
        return buildJsonObject {
            put("status", JsonPrimitive(health.status))
            put("uptimeSeconds", JsonPrimitive(health.uptimeSeconds))
            put("timestamp", JsonPrimitive(now))
            put("checks", buildJsonArray {
                health.checks.forEach { c ->
                    add(buildJsonObject { put("name", JsonPrimitive(c.name)); put("status", JsonPrimitive(c.status)) })
                }
            })
            put("counts", buildJsonObject {
                put("devices", JsonPrimitive(devices.count { !it.hidden }))
                put("auditLog", JsonPrimitive(auditCount))
                put("pendingJobs", JsonPrimitive(jobs.status(householdId).pendingJobs))
                put("failedJobs", JsonPrimitive(jobs.status(householdId).failedJobs))
            })
        }
    }

    fun pruneAudit(retentionDays: Int = 365): Int {
        val cutoff = time.now() - retentionDays.toLong() * 86_400_000L
        return runCatching { db.write { coreQueries.deleteAuditLogBefore(cutoff) }; 0 }.getOrDefault(0)
    }

    fun pruneAttributeLog(retentionDays: Int = 31): Int {
        val cutoff = time.now() - retentionDays.toLong() * 86_400_000L
        return runCatching { db.write { coreQueries.deleteEntityAttributeLogBefore(cutoff) }; 0 }.getOrDefault(0)
    }
}
