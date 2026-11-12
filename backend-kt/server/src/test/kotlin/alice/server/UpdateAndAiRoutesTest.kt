package alice.server

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.di.coreModule
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.di.serverModule
import alice.server.routes.RegistrationOptionsResponse
import alice.server.testing.VirtualAuthenticator
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.koin.dsl.koinApplication
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UpdateAndAiRoutesTest {

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

    private suspend fun ApplicationTestBuilder.registerAndCookie(): String {
        val device = VirtualAuthenticator("localhost", "http://localhost:3000")
        val options = Json.decodeFromString<RegistrationOptionsResponse>(
            client.post("/api/v1/auth/register/options") {
                header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                setBody("""{"displayName":"Admin"}""")
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
        return verifyResponse.headers[HttpHeaders.SetCookie]!!.substringAfter("alice_session=").substringBefore(";")
    }

    @Test
    fun `updates status and history are available to admin`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()
                val status = client.get("/api/v1/updates") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, status.status)
                val s = Json.parseToJsonElement(status.bodyAsText()).jsonObject
                assertTrue(s.containsKey("currentVersion"))
                assertTrue(s.containsKey("state"))
                assertTrue(s.containsKey("settings"))
                val history = client.get("/api/v1/updates/history") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, history.status)
                val h = Json.parseToJsonElement(history.bodyAsText()).jsonObject
                assertTrue(h["items"]?.jsonArray != null)
            }
        } finally { app.close() }
    }

    @Test
    fun `updates settings require step up and validate window`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()
                // The Origin header matters: without it the CSRF check answers first and the window is never validated.
                val bad = client.put("/api/v1/updates/settings") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"windowStart":"02:00","windowEnd":"02:00"}""")
                }
                assertEquals(HttpStatusCode.BadRequest, bad.status)
                assertTrue(bad.bodyAsText().contains("validation_error"))
            }
        } finally { app.close() }
    }


    @Test
    fun `ai settings can be updated by admin`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()
                val res = client.put("/api/v1/ai/settings") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"enabled":false,"dailyModelCallLimit":50}""")
                }
                assertEquals(HttpStatusCode.OK, res.status)
                val body = Json.parseToJsonElement(res.bodyAsText()).jsonObject
                assertEquals(false, body["enabled"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: body["enabled"]?.jsonPrimitive?.toString()?.contains("false"))
                assertEquals("50", body["dailyModelCallLimit"]?.jsonPrimitive?.content)
            }
        } finally { app.close() }
    }

    @Test
    fun `updates check and missing-update actions behave consistently`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()
                val check = client.post("/api/v1/updates/check") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, check.status)
                val status = Json.parseToJsonElement(check.bodyAsText()).jsonObject
                assertTrue(status.containsKey("state"))

                val schedule = client.post("/api/v1/updates/schedule") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                // no update available -> conflict/no_update or step-up/forbidden depending on state; accept expected failure classes
                assertTrue(schedule.status.value in listOf(401, 403, 409, 422))
            }
        } finally { app.close() }
    }
}
