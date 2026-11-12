package alice.server.http

import alice.server.auth.AuthService
import alice.server.households.HouseholdService
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.request.path

class SessionConfig {
    lateinit var auth: AuthService
    lateinit var households: HouseholdService
    var secureCookies: Boolean = false

    fun requireConfigured() {
        val missing = buildList {
            if (!this@SessionConfig::auth.isInitialized) add("auth")
            if (!this@SessionConfig::households.isInitialized) add("households")
        }
        check(missing.isEmpty()) { "SessionPlugin is missing required configuration: ${missing.joinToString(", ")}" }
    }
}

/**
 * Resolves the session cookie into `{session, membership}` for API requests,
 * and refreshes the cookie when the session slid its expiry forward. Mirrors
 * `backend/src/core/http/session-plugin.ts`.
 *
 * Only `/api/v1/` needs a session: health checks and other public traffic
 * should not touch the database.
 */
val SessionPlugin = createApplicationPlugin(name = "Session", createConfiguration = ::SessionConfig) {
    pluginConfig.requireConfigured()
    onCall { call ->
        if (!call.request.path().startsWith("/api/v1/")) return@onCall

        val token = call.request.cookies[SESSION_COOKIE]
        val session = pluginConfig.auth.getSession(token)
        val membership = session?.let { pluginConfig.households.getMembership(it.userId) }
        call.attributes.put(RequestAuthKey, RequestAuth(session, membership))

        val renewedUntil = session?.renewedUntil
        if (renewedUntil != null && token != null) {
            // Without this the browser would drop the cookie at the old expiry.
            call.response.cookies.append(sessionCookie(token, renewedUntil, pluginConfig.secureCookies))
        }
    }
}
