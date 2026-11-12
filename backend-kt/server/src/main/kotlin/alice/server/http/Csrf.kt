package alice.server.http

import alice.core.error.AppException
import alice.core.error.ErrorCode
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path

class CsrfConfig {
    /** Origins allowed to make cookie-authenticated state changes. */
    var allowedOrigins: Set<String> = emptySet()
}

/**
 * Cross-site request protection for cookie sessions, on top of SameSite=Lax,
 * ported from `backend/src/core/http/csrf.ts`.
 *
 * A request that changes something and carries the session cookie must come
 * from one of this app's own origins. Browsers always send `Origin` on a
 * cross-site request, so a forged one is refused; a script (which sends no
 * Origin) must say so with `X-Requested-With`, which a forged form cannot add.
 * Bearer-token support staff are unaffected because they carry no cookie.
 */
val CsrfPlugin = createApplicationPlugin(name = "Csrf", createConfiguration = ::CsrfConfig) {
    onCall { call ->
        if (!call.request.path().startsWith("/api/v1/")) return@onCall
        if (call.request.httpMethod in SAFE_METHODS) return@onCall
        if (call.request.cookies[SESSION_COOKIE] == null) return@onCall

        val origin = call.request.headers[HttpHeaders.Origin]
        if (origin != null) {
            if (origin !in pluginConfig.allowedOrigins) {
                throw AppException(ErrorCode.CSRF_BLOCKED, "This request came from another site", 403)
            }
        } else if (call.request.headers[CSRF_HEADER] == null) {
            throw AppException(ErrorCode.CSRF_BLOCKED, "This request did not say where it came from", 403)
        }
    }
}

private const val CSRF_HEADER = "X-Requested-With"

private val SAFE_METHODS = setOf(HttpMethod.Get, HttpMethod.Head, HttpMethod.Options)
