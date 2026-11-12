package alice.server

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.di.coreModule
import alice.server.di.serverModule
import alice.server.routes.RegistrationOptionsResponse
import alice.server.testing.VirtualAuthenticator
import alice.server.auth.passkey.RegistrationResponseJson
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test
import org.koin.dsl.koinApplication
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AuthRoutesTest {

    private fun newApp() = koinApplication {
        modules(
            coreModule(
                AppConfig(
                    database = DatabaseConfig(path = ":memory:"),
                    webauthn = WebAuthnConfig(rpId = "localhost", origin = "http://localhost:3000"),
                ),
            ),
            serverModule(),
        )
    }

    @Test
    fun `health is public`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val r = client.get("/health")
                assertEquals(HttpStatusCode.OK, r.status)
            }
        } finally {
            app.close()
        }
    }

    @Test
    fun `registration over HTTP sets the session cookie and the session endpoint reads it`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val device = VirtualAuthenticator("localhost", "http://localhost:3000")

                val optionsResponse = client.post("/api/v1/auth/register/options") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"displayName":"Gokul"}""")
                }
                assertEquals(HttpStatusCode.OK, optionsResponse.status)
                val options = Json.decodeFromString<RegistrationOptionsResponse>(optionsResponse.bodyAsText())

                val verifyResponse = client.post("/api/v1/auth/register/verify") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody(
                        """{"challengeId":"${options.challengeId}","response":${
                            Json.encodeToString(RegistrationResponseJson.serializer(), device.create(options.options.challenge))
                        }}""",
                    )
                }
                assertEquals(HttpStatusCode.OK, verifyResponse.status)
                val setCookie = verifyResponse.headers[HttpHeaders.SetCookie] ?: ""
                assertTrue(setCookie.contains("alice_session="))
                val cookieValue = setCookie.substringAfter("alice_session=").substringBefore(";")

                val sessionResponse = client.get("/api/v1/auth/session") {
                    header(HttpHeaders.Cookie, "alice_session=$cookieValue")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, sessionResponse.status)
                assertTrue(sessionResponse.bodyAsText().contains("\"userId\""))
            }
        } finally {
            app.close()
        }
    }

    @Test
    fun `a cookie-authenticated state change without an origin is blocked by CSRF`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val device = VirtualAuthenticator("localhost", "http://localhost:3000")
                val options = Json.decodeFromString<RegistrationOptionsResponse>(
                    client.post("/api/v1/auth/register/options") {
                        header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                        setBody("""{"displayName":"Gokul"}""")
                    }.bodyAsText(),
                )
                val verifyResponse = client.post("/api/v1/auth/register/verify") {
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody(
                        """{"challengeId":"${options.challengeId}","response":${
                            Json.encodeToString(RegistrationResponseJson.serializer(), device.create(options.options.challenge))
                        }}""",
                    )
                }
                val cookieValue = verifyResponse.headers[HttpHeaders.SetCookie]!!.substringAfter("alice_session=").substringBefore(";")

                val blocked = client.post("/api/v1/auth/logout") {
                    header(HttpHeaders.Cookie, "alice_session=$cookieValue")
                }
                assertEquals(HttpStatusCode.Forbidden, blocked.status)
                assertTrue(blocked.bodyAsText().contains("csrf_blocked"))

                val ok = client.post("/api/v1/auth/logout") {
                    header(HttpHeaders.Cookie, "alice_session=$cookieValue")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, ok.status)
            }
        } finally {
            app.close()
        }
    }

    @Test
    fun `CORS echoes an allowed origin and credentials`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val r = client.get("/health") {
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals("http://localhost:3000", r.headers[HttpHeaders.AccessControlAllowOrigin])
                assertEquals("true", r.headers[HttpHeaders.AccessControlAllowCredentials])
            }
        } finally {
            app.close()
        }
    }

    @Test
    fun `rate limiting returns 429 with Retry-After`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                repeat(30) { client.get("/api/v1/auth/setup") }
                val r = client.get("/api/v1/auth/setup")
                assertEquals(HttpStatusCode.TooManyRequests, r.status)
                assertTrue(r.headers["Retry-After"] != null)
                assertTrue(r.bodyAsText().contains("rate_limited"))
            }
        } finally {
            app.close()
        }
    }
}
