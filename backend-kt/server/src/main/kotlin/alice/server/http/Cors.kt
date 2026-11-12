package alice.server.http

import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.request.httpMethod
import io.ktor.server.response.respond

class CorsConfig {
    /** Origins allowed to send credentials, e.g. `http://localhost:3000`. */
    var allowedOrigins: Set<String> = emptySet()
}

/**
 * CORS for the browser frontend, matching `@elysiajs/cors` (the TypeScript
 * backend's plugin) rather than a stricter interpretation:
 *
 *  - `Access-Control-Allow-Credentials: true` on every response.
 *  - A request whose `Origin` is allowed also gets
 *    `Access-Control-Allow-Origin` and `Vary: Origin`; an unknown origin is
 *    not blocked, it simply gets no CORS headers, exactly as Elysia does.
 *  - `OPTIONS` is answered directly with `204`, the requested method echoed in
 *    `Access-Control-Allow-Methods` and a 5-second preflight cache.
 *
 * The browser is what enforces this; the server-side CSRF check is the actual
 * security boundary for state-changing requests.
 */
val CorsPlugin = createApplicationPlugin(name = "Cors", createConfiguration = ::CorsConfig) {
    val allowed = pluginConfig.allowedOrigins

    onCall { call ->
        call.response.headers.append(HttpHeaders.AccessControlAllowCredentials, "true")

        val origin = call.request.headers[HttpHeaders.Origin] ?: return@onCall
        if (origin !in allowed) return@onCall

        call.response.headers.append(HttpHeaders.Vary, HttpHeaders.Origin)
        call.response.headers.append(HttpHeaders.AccessControlAllowOrigin, origin)

        if (call.request.httpMethod == HttpMethod.Options) {
            call.request.headers[HttpHeaders.AccessControlRequestMethod]?.let { method ->
                call.response.headers.append(HttpHeaders.AccessControlAllowMethods, method)
            }
            call.response.headers.append(HttpHeaders.AccessControlMaxAge, PREFLIGHT_MAX_AGE_SECONDS.toString())
            call.respond(HttpStatusCode.NoContent)
            return@onCall
        }

        // Elysia echoes the request method here; harmless, and kept for parity.
        call.response.headers.append(HttpHeaders.AccessControlAllowMethods, call.request.httpMethod.value)
    }
}

private const val PREFLIGHT_MAX_AGE_SECONDS = 5
