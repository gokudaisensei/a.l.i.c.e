package alice.core.security

import alice.core.db.AliceDb
import alice.core.ids.Ids
import kotlinx.serialization.json.JsonObject

/**
 * Appends a security-relevant event. Never put secrets (tokens, codes) in
 * [detail]. Mirrors `backend/src/core/security/audit.ts`.
 */
object Audit {
    /**
     * Writes through the [alice.core.db.Database] lock. Use this outside a `write { }` block; handing the raw
     * database to another thread while a transaction is open on it makes SQLite answer "database is locked".
     */
    fun write(
        database: alice.core.db.Database,
        action: String,
        householdId: String? = null,
        actorId: String? = null,
        actorType: String = "user",
        resource: String? = null,
        detail: JsonObject? = null,
        now: Long = System.currentTimeMillis(),
    ) {
        database.write { write(this, action, householdId, actorId, actorType, resource, detail, now) }
    }

    fun write(
        db: AliceDb,
        action: String,
        householdId: String? = null,
        actorId: String? = null,
        actorType: String = "user",
        resource: String? = null,
        detail: JsonObject? = null,
        now: Long = System.currentTimeMillis(),
    ) {
        db.coreQueries.insertAuditLog(
            id = Ids.next("aud"),
            household_id = householdId,
            actor_type = actorType,
            actor_id = actorId,
            action = action,
            resource = resource,
            detail = detail?.toString(),
            created_at = now,
        )
    }
}
