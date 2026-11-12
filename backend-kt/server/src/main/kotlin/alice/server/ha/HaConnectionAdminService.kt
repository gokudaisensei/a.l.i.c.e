package alice.server.ha

import alice.core.config.AppConfig
import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.security.Sealed
import alice.core.time.TimeProvider
import alice.ha.StateCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URI

class HaConnectionAdminService(
    private val db: Database,
    private val config: AppConfig,
    private val time: TimeProvider,
    private val runtime: HaRuntime? = null,
    private val vault: alice.core.security.TokenVault = alice.core.security.TokenVault.ephemeral(),
    private val stateCache: StateCache? = null,
) {
    fun status(householdId: String): HaConnectionView {
        val r = db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
            ?: return HaConnectionView(configured = false)
        return HaConnectionView(
            configured = true,
            id = r.id,
            name = r.name,
            baseUrl = r.base_url,
            status = r.status,
            haVersion = r.ha_version,
            lastError = r.last_error,
            lastConnectedAt = r.last_connected_at,
            entities = stateCache?.size,
            syncedAt = runtime?.lastSyncedAt,
            adminTokenSet = r.admin_token_enc != null,
        )
    }

    fun setAdminToken(householdId: String, actorId: String, token: String) {
        val r = db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
            ?: throw notFound("Home Assistant connection")
        val pubEnv = config.adminSealPublicKey ?: throw AppException("not_configured", "Admin token storage is not set up (ADMIN_SEAL_PUBLIC_KEY)", 503)
        val pubKey = normalizePublicKey(pubEnv)
        val sealed = try { Sealed.seal(token, pubKey) } catch (e: Exception) {
            throw AppException("not_configured", "Admin seal public key is invalid", 503)
        }
        val now = time.now()
        db.write {
            identityQueries.updateHaConnectionAdminToken(sealed, now, r.id)
            Audit.write(this, action = "ha.admin_token_set", householdId = householdId, actorId = actorId, resource = r.id, now = now)
        }
    }

    fun putConnection(householdId: String, actorId: String, name: String?, baseUrl: String, token: String?): HaConnectionView {
        val normalizedUrl = baseUrl.trim().removeSuffix("/")
        if (normalizedUrl.isBlank()) throw validationError("Home Assistant URL is required")
        val uri = runCatching { URI(normalizedUrl) }.getOrElse { throw validationError("Home Assistant URL is not valid") }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "http" && scheme != "https") throw validationError("Home Assistant URL must use http or https")
        if (uri.host.isNullOrBlank()) throw validationError("Home Assistant URL must include a host")
        val now = time.now()
        val existing = db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
        if (existing == null) {
            val tok = token?.trim()?.takeIf { it.isNotEmpty() } ?: throw validationError("Home Assistant token is required")
            val id = Ids.next("hac")
            db.write {
                identityQueries.insertHaConnection(id, householdId, name?.trim()?.ifBlank { "Home Assistant" } ?: "Home Assistant", normalizedUrl, vault.seal(tok), null, "disconnected", now, now)
                Audit.write(this, action = "ha.connection_created", householdId = householdId, actorId = actorId, resource = id, now = now)
            }
        } else {
            val tok = token?.trim()?.takeIf { it.isNotEmpty() } ?: vault.open(existing.operational_token_enc)
            db.write {
                identityQueries.updateHaConnection(name?.trim()?.ifBlank { existing.name } ?: existing.name, normalizedUrl, vault.seal(tok), now, existing.id)
                Audit.write(this, action = "ha.connection_updated", householdId = householdId, actorId = actorId, resource = existing.id, now = now)
            }
        }
        runtime?.restart()
        return status(householdId)
    }

    suspend fun testConnection(householdId: String): Map<String, Any?> = withContext(Dispatchers.IO) {
        val r = db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
            ?: throw notFound("Home Assistant connection")
        val uri = runCatching { URI(r.base_url.trimEnd('/') + "/api/") }.getOrNull()
        val scheme = uri?.scheme?.lowercase()
        if (uri == null || (scheme != "http" && scheme != "https") || uri.host.isNullOrBlank()) {
            return@withContext mapOf("ok" to false, "status" to null, "reachable" to false, "error" to "Home Assistant URL is not valid")
        }
        var conn: HttpURLConnection? = null
        try {
            val url = uri.toURL()
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 5000
                readTimeout = 5000
                setRequestProperty("Authorization", "Bearer ${vault.open(r.operational_token_enc)}")
            }
            val code = conn.responseCode
            val ok = code in 200..299
            val reachable = code < 500
            val error = when {
                ok -> null
                code == 401 -> "Home Assistant rejected the access token"
                else -> "Home Assistant returned HTTP $code"
            }
            mapOf("ok" to ok, "status" to code, "reachable" to reachable, "error" to error)
        } catch (e: Exception) {
            mapOf("ok" to false, "status" to null, "reachable" to false, "error" to (e.message ?: "Could not reach Home Assistant"))
        } finally {
            conn?.disconnect()
        }
    }

    fun deleteConnection(householdId: String, actorId: String): Map<String, Any?> {
        val r = db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
            ?: throw notFound("Home Assistant connection")
        val now = time.now()
        db.write {
            identityQueries.deleteHaConnectionById(r.id)
            Audit.write(this, action = "ha.connection_deleted", householdId = householdId, actorId = actorId, resource = r.id, now = now)
        }
        runtime?.stop()
        return mapOf("deleted" to true)
    }

    fun resyncConnection(householdId: String, actorId: String, sync: alice.server.sync.ConfigSyncService?): Map<String, Any?> {
        val r = db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull() }
            ?: throw notFound("Home Assistant connection")
        val result = alice.core.concurrent.runCatchingNonCancellation { sync?.verify(householdId) ?: false }
        val triggered = result.getOrNull() ?: false
        val failure = result.exceptionOrNull()
        Audit.write(db, action = "ha.connection_resync_requested", householdId = householdId, actorId = actorId, resource = r.id, now = time.now())
        return if (triggered) {
            mapOf("ok" to true, "triggered" to true)
        } else {
            mapOf("ok" to false, "triggered" to false, "error" to (failure?.message ?: "Home Assistant verification could not be queued"))
        }
    }

    private fun normalizePublicKey(value: String): String {
        val t = value.trim()
        return if (t.contains("-----BEGIN")) {
            t.lineSequence().filter { !it.startsWith("-----") }.joinToString("").replace("\\s".toRegex(), "")
        } else t
    }
}

@kotlinx.serialization.Serializable
data class HaConnectionView(
    val configured: Boolean,
    val id: String? = null,
    val name: String? = null,
    val baseUrl: String? = null,
    val status: String? = null,
    val haVersion: String? = null,
    val lastError: String? = null,
    val lastConnectedAt: Long? = null,
    val entities: Int? = null,
    val syncedAt: String? = null,
    val adminTokenSet: Boolean? = null,
)
