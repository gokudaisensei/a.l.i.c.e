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

class SmartRoutesTest {
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

    @Test fun `home endpoint returns composite response`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.registerCookie()
                val r = client.get("/api/v1/home") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, r.status)
                val body = r.bodyAsText()
                assertTrue(body.contains("\"generation\""))
                assertTrue(body.contains("\"devices\""))
                assertTrue(body.contains("\"household\""))
                assertTrue(r.headers[HttpHeaders.ETag] != null)
            }
        } finally { app.close() }
    }

    @Test fun `home etag returns 304`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.registerCookie()
                val first = client.get("/api/v1/home") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                val etag = first.headers[HttpHeaders.ETag]!!
                val second = client.get("/api/v1/home") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                    header(HttpHeaders.IfNoneMatch, etag)
                }
                assertEquals(HttpStatusCode.NotModified, second.status)
            }
        } finally { app.close() }
    }

    @Test fun `search endpoint works for empty and query`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.registerCookie()
                val r1 = client.get("/api/v1/search") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, r1.status)
                assertTrue(r1.bodyAsText().contains("\"usual\""))
                val r2 = client.get("/api/v1/search?q=light") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, r2.status)
                assertTrue(r2.bodyAsText().contains("\"results\""))
            }
        } finally { app.close() }
    }

    @Test fun `home why endpoint returns factors`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.registerCookie()
                val r = client.get("/api/v1/home/why?thingId=t1&action=turn_on") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                }
                assertEquals(HttpStatusCode.OK, r.status)
                assertTrue(r.bodyAsText().contains("\"factors\""))
            }
        } finally { app.close() }
    }

    @Test fun `home order ack accepts generation`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = client.registerCookie()
                val r = client.post("/api/v1/home/order/ack") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"generation":1}""")
                }
                assertEquals(HttpStatusCode.OK, r.status)
                assertTrue(r.bodyAsText().contains("\"ack\""))
            }
        } finally { app.close() }
    }
}
