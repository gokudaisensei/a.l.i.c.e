package alice.server.support

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.security.Tokens
import alice.core.time.TimeProvider
import alice.server.admin.AdminService
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import java.security.MessageDigest

@Serializable data class OperatorIdentity(val id: String, val label: String)
@Serializable data class OperatorHomeGrant(val id: String, val scope: Map<String, Boolean>, val endsAt: Long)
@Serializable data class OperatorHome(val householdId: String, val name: String, val grant: OperatorHomeGrant)

class OperatorService(
    private val db: Database,
    private val support: SupportService,
    private val admin: AdminService,
    private val things: ThingsService,
    private val time: TimeProvider,
) {
    private fun now() = time.now()
    private fun sha256(s: String): String = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    fun create(label: String, days: Int = 90): Triple<OperatorIdentity, String, Long> {
        if (days < 1 || days > 365) throw AppException("validation_error", "A token lasts between 1 and 365 days", 400)
        if (!Regex("^[a-z0-9][a-z0-9-]{1,30}$").matches(label)) throw AppException("validation_error", "Use lower-case letters, digits and dashes, e.g. ops-114", 400)
        val existing = db.read { coreQueries.selectOperatorByLabel(label).executeAsOneOrNull() }
        if (existing != null) throw AppException("conflict", "That operator already exists", 409)
        val token = "alice_op_${Tokens.randomToken(32)}"
        val id = Ids.next("opr")
        val expiresAt = now() + days * 86_400_000L
        db.write { coreQueries.insertOperator(id, label, sha256(token), now(), null, null, expiresAt) }
        return Triple(OperatorIdentity(id, label), token, expiresAt)
    }

    fun revoke(label: String) {
        val r = db.read { coreQueries.selectOperatorByLabel(label).executeAsOneOrNull() } ?: throw notFound("Operator")
        if (r.revoked_at != null) return
        db.write { coreQueries.revokeOperatorByLabel(now(), label) }
        val after = db.read { coreQueries.selectOperatorByLabel(label).executeAsOneOrNull() } ?: throw notFound("Operator")
        if (after.revoked_at == null) throw notFound("Operator")
    }

    fun authenticate(token: String?): OperatorIdentity {
        val t = token?.takeIf { it.isNotBlank() } ?: throw AppException("unauthenticated", "Support sign-in failed", 401)
        val row = db.read { coreQueries.selectOperatorByTokenHash(sha256(t)).executeAsOneOrNull() }
            ?: throw AppException("unauthenticated", "Support sign-in failed", 401)
        val exp = row.expires_at
        if (row.revoked_at != null || (exp != null && exp <= now())) {
            throw AppException("unauthenticated", "Support sign-in failed", 401)
        }
        db.write { coreQueries.updateOperatorLastSeen(now(), row.id) }
        return OperatorIdentity(row.id, row.label)
    }

    fun homes(): List<OperatorHome> {
        return db.read { identityQueries.selectAllHouseholds().executeAsList() }.mapNotNull { h ->
            val g = support.active(h.id) ?: return@mapNotNull null
            OperatorHome(h.id, h.name, OperatorHomeGrant(g.id, g.scope, g.endsAt))
        }
    }

    private fun grant(op: OperatorIdentity, householdId: String, scope: String): SupportView {
        val g = support.active(householdId) ?: throw AppException("no_grant", "This household has not given support access, or it has ended", 403)
        if (g.scope[scope] != true) {
            val what = if (scope == "health") "system health" else "the device list"
            throw AppException("out_of_scope", "The household did not allow support to see $what", 403)
        }
        Audit.write(db, "support.operator_action", householdId, op.label, "support", if (scope == "health") "/admin/health" else "/devices", kotlinx.serialization.json.buildJsonObject { put("scope", kotlinx.serialization.json.JsonPrimitive(scope)) }, now())
        return g
    }

    fun health(op: OperatorIdentity, householdId: String) = run {
        grant(op, householdId, "health")
        admin.health(householdId)
    }

    suspend fun devicesOf(op: OperatorIdentity, householdId: String): kotlinx.serialization.json.JsonObject {
        val g = grant(op, householdId, "devices")
        val c = Caller(householdId, "operator:${op.label}", alice.server.households.Role.ADMIN, false)
        val devices = things.things(householdId, includeHidden = false).mapNotNull { t ->
            val vis = runCatching { things.visible(c, t.id) }.getOrNull() ?: return@mapNotNull null
            val v = vis.view
            val primary = v.primary ?: return@mapNotNull null
            if (!g.scope.getOrDefault("cameras", false) && primary.domain == "camera") return@mapNotNull null
            mapOf(
                "id" to v.id,
                "name" to v.name,
                "areaId" to v.areaId,
                "domain" to primary.domain,
                "available" to v.available,
                "hidden" to v.hidden,
                "values" to if (primary.domain == "camera") emptyMap<String, Any?>() else primary.values,
            )
        }
        // JSON built from plain values: a Map with mixed value types cannot be serialized by Ktor.
        return alice.server.commands.anyToJsonElement(mapOf("devices" to devices)) as kotlinx.serialization.json.JsonObject
    }
}
