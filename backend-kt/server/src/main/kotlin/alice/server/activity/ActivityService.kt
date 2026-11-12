package alice.server.activity

import alice.core.db.Database
import alice.core.error.notFound
import alice.core.events.EventBus
import alice.core.events.ActivityRecorded
import alice.core.ids.Ids
import alice.core.time.TimeProvider
import alice.server.households.HouseholdService
import alice.server.permissions.can
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

@Serializable
data class ActivityActor(val id: String, val name: String)

@Serializable
data class ActivityItem(
    val id: String,
    val kind: String,
    val summary: String,
    val tone: String,
    val actor: ActivityActor? = null,
    val thingId: String? = null,
    val at: Long,
    val new: Boolean,
)

@Serializable
data class ActivityListResponse(val items: List<ActivityItem>, val nextCursor: String? = null, val newCount: Int)

class ActivityService(
    private val db: Database,
    private val bus: EventBus,
    private val things: ThingsService,
    private val households: HouseholdService,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false },
) {
    private val retentionMs = 90L * 24L * 3_600_000L

    fun canSee(c: Caller, row: alice.core.db.Activity_events): Boolean {
        if (!can(c.role, "activity.view")) return false
        val entityId = row.entity_id
        val connId = row.connection_id
        if (entityId.isNullOrBlank() || connId.isNullOrBlank()) return true
        // best-effort device visibility check
        return things.canSee(c, connId, entityId)
    }

    private fun lastSeen(c: Caller): Long =
        db.read { identityQueries.selectActivityRead(c.userId, c.householdId).executeAsOneOrNull() }?.last_seen_at ?: 0L

    private fun actorName(userId: String?): String? {
        if (userId == null) return null
        return db.read { identityQueries.selectUserById(userId).executeAsOneOrNull() }?.display_name ?: "Someone"
    }

    private fun thingIdFor(householdId: String, entityId: String?): String? {
        if (entityId == null) return null
        return try { kotlinx.coroutines.runBlocking { things.findEntity(householdId, entityId)?.thing?.id } } catch (_: Throwable) { null }
    }

    private fun toItem(row: alice.core.db.Activity_events, seen: Long): ActivityItem {
        val actor = row.actor_user_id?.let { ActivityActor(it, actorName(it) ?: "Someone") }
        return ActivityItem(
            id = row.id,
            kind = row.kind,
            summary = row.summary,
            tone = row.tone,
            actor = actor,
            thingId = thingIdFor(row.household_id, row.entity_id),
            at = row.created_at,
            new = row.created_at > seen,
        )
    }

    fun list(c: Caller, limit: Int = 30, before: String? = null, kind: String? = null): ActivityListResponse {
        if (!can(c.role, "activity.view")) return ActivityListResponse(emptyList(), null, 0)
        val lim = limit.coerceIn(1, 100)
        val seen = lastSeen(c)
        var cursorCreatedAt: Long? = null
        var cursorId: String? = null
        if (!before.isNullOrBlank()) {
            val parts = before.split(":", limit = 2)
            cursorCreatedAt = parts.getOrNull(0)?.toLongOrNull()
            cursorId = parts.getOrNull(1)
        }
        val out = mutableListOf<alice.core.db.Activity_events>()
        var curT = cursorCreatedAt
        var curId = cursorId
        var more = false
        for (guard in 0 until 20) {
            if (out.size > lim) break
            val rows = db.read { identityQueries.selectActivityPageDesc(c.householdId, kind, curT, curId ?: "", 100L).executeAsList() }
            if (rows.isEmpty()) break
            for (r in rows) if (canSee(c, r)) out.add(r)
            val last = rows.last()
            curT = last.created_at; curId = last.id
            if (rows.size < 100) { more = false; break } else more = true
        }
        val page = out.take(lim)
        val hasMore = out.size > lim || (more && out.size == lim)
        val nextCursor = if (hasMore && page.isNotEmpty()) "${page.last().created_at}:${page.last().id}" else null
        val newCount = if (seen == 0L) 0 else db.read { identityQueries.selectRecentActivityForNewCount(c.householdId).executeAsList() }
            .count { it.created_at > seen && canSee(c, it) }
        return ActivityListResponse(page.map { toItem(it, seen) }, nextCursor, newCount)
    }

    fun viewFor(c: Caller, eventId: String): ActivityItem? {
        if (!can(c.role, "activity.view")) return null
        val row = db.read { identityQueries.selectActivityEventById(eventId).executeAsOneOrNull() } ?: return null
        if (row.household_id != c.householdId || !canSee(c, row)) return null
        return toItem(row, lastSeen(c))
    }

    fun markSeen(c: Caller) {
        val t = time.now()
        db.write { identityQueries.upsertActivityRead(c.userId, c.householdId, t) }
    }

    fun record(
        householdId: String,
        kind: String,
        actorUserId: String?,
        connectionId: String?,
        entityId: String?,
        summary: String,
        tone: String = "info",
        data: JsonElement? = null,
        at: Long? = null,
        dedupeWithinMs: Long = 0L,
    ): String? {
        val ts = at ?: time.now()
        if (dedupeWithinMs > 0) {
            val recent = db.read { identityQueries.selectRecentActivityForNewCount(householdId).executeAsList() }
            val dup = recent.any { r ->
                r.kind == kind && r.entity_id == entityId && r.summary == summary && kotlin.math.abs(r.created_at - ts) <= dedupeWithinMs
            }
            if (dup) return null
        }
        val id = Ids.next("act")
        db.write {
            identityQueries.insertActivityEvent(id, householdId, kind, actorUserId, connectionId, entityId, summary, tone, data?.let { json.encodeToString(it) }, ts)
        }
        bus.publish(ActivityRecorded(householdId, java.time.Instant.ofEpochMilli(ts).toString(), id, mutableMapOf("id" to id, "kind" to kind, "summary" to summary, "tone" to tone)))
        return id
    }

    fun prune(): Int {
        val cutoff = time.now() - retentionMs
        return db.write { identityQueries.deleteOldActivityEvents(cutoff).executeAsList().size }
    }
}
