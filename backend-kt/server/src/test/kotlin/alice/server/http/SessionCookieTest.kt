package alice.server.http

import io.ktor.client.request.get
import io.ktor.client.statement.HttpResponse
import io.ktor.http.HttpHeaders
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SessionCookieTest {
    private fun cookieHeader(response: HttpResponse): String =
        response.headers.getAll(HttpHeaders.SetCookie)!!.single { it.startsWith("$SESSION_COOKIE=") }

    private fun assertCookie(text: String, secure: Boolean, maxAge: Int) {
        assertTrue(text.contains("HttpOnly"), text)
        assertTrue(text.contains("Path=/"), text)
        assertTrue(Regex("(?i)samesite=Lax").containsMatchIn(text), text)
        assertEquals(secure, text.contains("Secure"), text)
        assertTrue(text.contains("Max-Age=$maxAge"), text)
    }

    @Test
    fun `session and expired cookies keep their attributes with and without secure`() = testApplication {
        application {
            routing {
                get("/session/{secure}") {
                    val secure = call.parameters["secure"] == "true"
                    call.response.cookies.append(sessionCookie("tok", 1_700_000_060_000, secure, now = 1_700_000_000_000))
                    call.respondText("ok")
                }
                get("/expired/{secure}") {
                    val secure = call.parameters["secure"] == "true"
                    call.response.cookies.append(expiredSessionCookie(secure))
                    call.respondText("ok")
                }
            }
        }
        for (secure in listOf(true, false)) {
            assertCookie(cookieHeader(client.get("/session/$secure")), secure, 60)
            assertCookie(cookieHeader(client.get("/expired/$secure")), secure, 0)
        }
        assertFalse(cookieHeader(client.get("/session/false")).contains("Secure"))
        assertTrue(cookieHeader(client.get("/session/true")).contains("Secure"))
    }

    @Test
    fun `the cookie attribute helper no longer takes the ignored secure parameter`() {
        val source = File("src/main/kotlin/alice/server/http/SessionCookie.kt").readText()
        assertFalse(source.contains("sessionCookieAttributes("), "the unused secure parameter should be gone")
    }
}
