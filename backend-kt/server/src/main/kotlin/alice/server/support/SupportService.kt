package alice.server.support

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.server.notifications.NotificationsService
import alice.server.notifications.NewNotification
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject

val SUPPORT_SCOPES = listOf("health", "devices", "cameras", "control")
const val MAX_TOTAL_HOURS = 24
private const val HOUR = 3_600_000L

@Serializable
data class SupportView(
    val id: String,
    val scope: Map<String, Boolean>,
    val startsAt: Long,
    val endsAt: Long,
    val durationHours: Double,
    val active: Boolean,
    val endedAt: Long? = null,
    val endedBy: String? = null,
    val grantedBy: String? = null,
)

@Serializable data class SupportLogItem(val at: Long, val text: String)
@Serializable data class OperatorTrailItem(val at: Long, val operator: String, val action: String, val target: String? = null)
@Serializable data class SupportState(
    val active: SupportView? = null,
    val history: List<SupportView>,
    val householdLog: List<SupportLogItem>,
    val operatorTrail: List<OperatorTrailItem>,
)

class SupportService(
    private val db: Database,
    private val notifications: NotificationsService,
    private val time: TimeProvider,
) {
    private fun now() = time.now()

    private fun scopeMap(raw: String): Map<String, Boolean> {
        val obj = runCatching { Json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return SUPPORT_SCOPES.associateWith { false }
        return SUPPORT_SCOPES.associateWith { (obj[it] as? JsonPrimitive)?.booleanOrNull == true }
    }
    private fun name(userId: String): String? = db.read { identityQueries.selectUserById(userId).executeAsOneOrNull() }?.display_name
    private fun view(r: alice.core.db.Support_sessions, grantedName: String? = null): SupportView = SupportView(
        id = r.id,
        scope = scopeMap(r.scope),
        startsAt = r.starts_at,
        endsAt = r.ends_at,
        durationHours = kotlin.math.round(((r.ends_at - r.starts_at).toDouble() / HOUR) * 10.0) / 10.0,
        active = r.ended_at == null && r.ends_at > now(),
        endedAt = r.ended_at ?: r.ends_at.takeIf { it <= now() },
        endedBy = r.ended_by ?: "expiry".takeIf { r.ended_at == null && r.ends_at <= now() },
        grantedBy = grantedName,
    )

    /** A read: whether a session has run out is decided by its end time, not by a write that marks it. */
    fun active(householdId: String): SupportView? {
        val r = db.read { coreQueries.selectActiveSupportSession(householdId, now()).executeAsOneOrNull() } ?: return null
        return view(r, name(r.granted_by))
    }

    fun history(householdId: String): List<SupportView> {
        return db.read { coreQueries.selectSupportSessionsByHousehold(householdId).executeAsList() }.take(20).map { view(it, name(it.granted_by)) }
    }

    fun grant(householdId: String, userId: String, hours: Int, scopeInput: Map<String, Boolean>): SupportView {
        db.write { coreQueries.expireSupportSessions(now()) }
        if (active(householdId) != null) throw AppException("support_active", "Support already has access. End it first or add time to it", 409)
        if (hours < 1 || hours > MAX_TOTAL_HOURS) throw AppException("validation_error", "Choose between 1 and $MAX_TOTAL_HOURS hours", 400)
        val scope = SUPPORT_SCOPES.associateWith { scopeInput[it] == true }
        if (!scope.values.any { it }) throw AppException("validation_error", "Choose at least one thing support may see", 400)
        val t = now()
        val id = Ids.next("sup")
        val ends = t + hours * HOUR
        val scopeJson = buildJsonObject { scope.forEach { (k, v) -> put(k, JsonPrimitive(v)) } }.toString()
        db.write { coreQueries.insertSupportSession(id, householdId, userId, scopeJson, t, ends, null, null, t) }
        Audit.write(db, "support.granted", householdId, userId, "user", id, buildJsonObject { put("hours", JsonPrimitive(hours)); put("scope", Json.parseToJsonElement(scopeJson)) }, time.now())
        runCatching {
            notifications.notifyAdmins(householdId, NewNotification(kind = "support_access", title = "Support access was given", body = "${name(userId) ?: "An admin"} gave support access for $hours hour${if (hours == 1) "" else "s"}. It ends on its own."))
        }
        return active(householdId)!!
    }

    private fun session(householdId: String, id: String): alice.core.db.Support_sessions =
        db.read { coreQueries.selectSupportSessionById(id, householdId).executeAsOneOrNull() } ?: throw notFound("Support session")

    fun extend(householdId: String, userId: String, id: String, hours: Int = 1): SupportView {
        db.write { coreQueries.expireSupportSessions(now()) }
        val r = session(householdId, id)
        if (r.ended_at != null) throw AppException("support_ended", "That access has already ended", 409)
        if (r.ends_at + hours * HOUR - r.starts_at > MAX_TOTAL_HOURS * HOUR) throw AppException("validation_error", "Access can last at most $MAX_TOTAL_HOURS hours in total", 400)
        db.write { coreQueries.updateSupportSessionExtend(r.ends_at + hours * HOUR, id) }
        Audit.write(db, "support.extended", householdId, userId, "user", id, buildJsonObject { put("hours", JsonPrimitive(hours)) }, time.now())
        return view(session(householdId, id), name(r.granted_by))
    }

    fun end(householdId: String, userId: String, id: String): SupportView {
        db.write { coreQueries.expireSupportSessions(now()) }
        val r = session(householdId, id)
        if (r.ended_at == null) {
            db.write { coreQueries.endSupportSession(now(), "user", id) }
            Audit.write(db, "support.ended", householdId, userId, "user", id, null, time.now())
        }
        return view(session(householdId, id), name(r.granted_by))
    }

    fun householdLog(householdId: String, limit: Int = 20): List<SupportLogItem> {
        val rows = db.read { coreQueries.selectAuditPage(householdId, "support.", null, "", limit.toLong()).executeAsList() }
        return rows.map { a ->
            val who = a.actor_id?.let { name(it) } ?: "An admin"
            val d = a.detail?.let { runCatching { Json.parseToJsonElement(it).jsonObject }.getOrNull() }
            val hours = (d?.get("hours") as? JsonPrimitive)?.content?.toIntOrNull()
            val text = when (a.action) {
                "support.granted" -> "$who gave support access for $hours hour${if (hours == 1) "" else "s"}"
                "support.extended" -> "$who added ${hours ?: 1} hour of support access"
                "support.ended" -> "$who ended support access"
                "support.expired" -> "Support access ended on its own"
                "support.operator_action" -> "Support looked at something you allowed"
                else -> a.action
            }
            SupportLogItem(a.created_at, text)
        }
    }

    fun operatorTrail(householdId: String, limit: Int = 20): List<OperatorTrailItem> {
        return db.read { coreQueries.selectAuditByActorType(householdId, "support", limit.toLong()).executeAsList() }
            .map { OperatorTrailItem(it.created_at, it.actor_id ?: "support", it.action, it.resource) }
    }

    fun state(householdId: String): SupportState = SupportState(active(householdId), history(householdId), householdLog(householdId), operatorTrail(householdId))
}
