package alice.server

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.di.coreModule
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.di.serverModule
import alice.server.routes.RegistrationOptionsResponse
import alice.server.testing.VirtualAuthenticator
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.koin.dsl.koinApplication
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RealtimeWsIntegrationTest {
    private val json = Json { ignoreUnknownKeys = true }

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

    @Test
    fun `authenticated websocket receives hello and supports ping subscribe`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val client = createClient { install(WebSockets) }
                val cookie = client.registerCookie()
                client.webSocket("/ws", request = {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }) {
                    val hello = withTimeout(2000) { json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject }
                    assertEquals("hello", hello["type"]!!.jsonPrimitive.content)
                    assertEquals("admin", hello["data"]!!.jsonObject["role"]!!.jsonPrimitive.content)

                    send(Frame.Text("""{"type":"ping","requestId":"p1"}"""))
                    val pong = withTimeout(2000) { json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject }
                    assertEquals("pong", pong["type"]!!.jsonPrimitive.content)
                    assertEquals("p1", pong["requestId"]!!.jsonPrimitive.content)

                    send(Frame.Text("""{"type":"subscribe","resource":"devices","requestId":"s1"}"""))
                    val sub = withTimeout(2000) { json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject }
                    assertEquals("subscribed", sub["type"]!!.jsonPrimitive.content)
                    assertEquals("s1", sub["requestId"]!!.jsonPrimitive.content)
                }
            }
        } finally { app.close() }
    }

    @Test
    fun `unauthenticated websocket is rejected`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val client = createClient { install(WebSockets) }
                var code: Short? = null
                client.webSocket("/ws") {
                    code = withTimeout(2000) { closeReason.await() }?.code
                }
                assertEquals(4401.toShort(), code)
            }
        } finally { app.close() }
    }

    @Test
    fun `garbage and unknown messages return errors but socket stays open`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val client = createClient { install(WebSockets) }
                val cookie = client.registerCookie()
                client.webSocket("/ws", request = {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }) {
                    withTimeout(2000) { incoming.receive() } // hello
                    send(Frame.Text("{not json"))
                    val err = withTimeout(2000) { json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject }
                    assertEquals("error", err["type"]!!.jsonPrimitive.content)
                    assertEquals("bad_message", err["data"]!!.jsonObject["code"]!!.jsonPrimitive.content)
                    send(Frame.Text("""{"type":"ping","requestId":"after"}"""))
                    val pong = withTimeout(2000) { json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject }
                    assertEquals("pong", pong["type"]!!.jsonPrimitive.content)
                }
            }
        } finally { app.close() }
    }
}
