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
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test
import org.koin.dsl.koinApplication
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DeviceRoutesTest {
    private fun newApp() = koinApplication {
        modules(
            coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"), webauthn = WebAuthnConfig(rpId = "localhost", origin = "http://localhost:3000"))),
            serverModule(),
        )
    }

    private suspend fun io.ktor.client.HttpClient.registerCookie(): String {
        val device = VirtualAuthenticator("localhost", "http://localhost:3000")
        val options = Json.decodeFromString<RegistrationOptionsResponse>(
            post("/api/v1/auth/register/options") {
                header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                setBody("""{"displayName":"Gokul"}""")
            }.bodyAsText(),
        )
        val verifyResponse = post("/api/v1/auth/register/verify") {
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            setBody("""{"challengeId":"${options.challengeId}","response":${Json.encodeToString(RegistrationResponseJson.serializer(), device.create(options.options.challenge))}}""")
        }
        return verifyResponse.headers[HttpHeaders.SetCookie]!!.substringAfter("alice_session=").substringBefore(";")
    }

    @Test fun `devices list returns empty for new user`() = runRoute { cookie, c ->
        val r = c.get("/api/v1/devices") { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, "http://localhost:3000") }
        assertEquals(HttpStatusCode.OK, r.status); assertTrue(r.bodyAsText().contains("\"devices\""))
    }

    @Test fun `areas list returns empty for new user`() = runRoute { cookie, c ->
        val r = c.get("/api/v1/areas") { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, "http://localhost:3000") }
        assertEquals(HttpStatusCode.OK, r.status)
    }

    @Test fun `commands list returns empty for new user`() = runRoute { cookie, c ->
        val r = c.get("/api/v1/commands") { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, "http://localhost:3000") }
        assertEquals(HttpStatusCode.OK, r.status)
    }

    @Test fun `favorites list returns empty for new user`() = runRoute { cookie, c ->
        val r = c.get("/api/v1/favorites") { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, "http://localhost:3000") }
        assertEquals(HttpStatusCode.OK, r.status)
    }

    @Test fun `user me returns user info`() = runRoute { cookie, c ->
        val r = c.get("/api/v1/users/me") { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, "http://localhost:3000") }
        assertEquals(HttpStatusCode.OK, r.status); assertTrue(r.bodyAsText().contains("\"displayName\""))
    }

    @Test fun `household mode get returns home`() = runRoute { cookie, c ->
        val r = c.get("/api/v1/household/mode") { header(HttpHeaders.Cookie, "alice_session=$cookie"); header(HttpHeaders.Origin, "http://localhost:3000") }
        assertEquals(HttpStatusCode.OK, r.status); assertTrue(r.bodyAsText().contains("\"mode\""))
    }

    private fun runRoute(block: suspend (String, io.ktor.client.HttpClient) -> Unit) {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.registerCookie()
                block(cookie, client)
            }
        } finally { app.close() }
    }
}
