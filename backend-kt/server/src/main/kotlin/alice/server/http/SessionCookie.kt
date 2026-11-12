package alice.server.http

import io.ktor.http.Cookie

const val SESSION_COOKIE = "alice_session"

/**
 * One place for the session cookie attributes, matching
 * `backend/src/core/http/guards.ts`: HttpOnly, SameSite=Lax, Path=/ and Secure
 * whenever the configured origin is https.
 *
 * Ktor 3 has no `SameSite` on `Cookie`; it is written as a cookie extension,
 * which browsers parse as the `SameSite` attribute.
 */
private val SESSION_COOKIE_ATTRIBUTES = mapOf("samesite" to "Lax")

fun sessionCookie(
    value: String,
    expiresAt: Long,
    secure: Boolean,
    now: Long = System.currentTimeMillis(),
): Cookie = Cookie(
    name = SESSION_COOKIE,
    value = value,
    maxAge = ((expiresAt - now) / 1000).toInt().coerceAtLeast(0),
    expires = null,
    domain = null,
    path = "/",
    secure = secure,
    httpOnly = true,
    extensions = SESSION_COOKIE_ATTRIBUTES,
)

fun expiredSessionCookie(secure: Boolean): Cookie = Cookie(
    name = SESSION_COOKIE,
    value = "",
    maxAge = 0,
    expires = null,
    domain = null,
    path = "/",
    secure = secure,
    httpOnly = true,
    extensions = SESSION_COOKIE_ATTRIBUTES,
)
