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

class AdminBackupSupportRoutesTest {

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
    fun `admin health diagnostics audit and metrics are available to admin`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()

                val health = client.get("/api/v1/admin/health") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, health.status)
                val h = Json.parseToJsonElement(health.bodyAsText()).jsonObject
                assertTrue(h["status"]?.jsonPrimitive?.content in setOf("ok", "warn", "down"))
                assertTrue(h["checks"]?.jsonArray?.isNotEmpty() == true)

                val diag = client.get("/api/v1/admin/diagnostics") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, diag.status)
                val d = Json.parseToJsonElement(diag.bodyAsText()).jsonObject
                assertTrue(d.containsKey("app"))
                assertTrue(d.containsKey("counts"))

                val audit = client.get("/api/v1/admin/audit") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, audit.status)
                val a = Json.parseToJsonElement(audit.bodyAsText()).jsonObject
                assertTrue(a.containsKey("items"))

                val metrics = client.get("/api/v1/admin/metrics") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, metrics.status)
                val m = Json.parseToJsonElement(metrics.bodyAsText()).jsonObject
                assertTrue(m.containsKey("uptimeSeconds"))
                assertTrue(m.containsKey("counts"))
            }
        } finally { app.close() }
    }

    @Test
    fun `backup routes list settings and reject in-memory create`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()

                val list = client.get("/api/v1/backups") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, list.status)
                val l = Json.parseToJsonElement(list.bodyAsText()).jsonObject
                assertTrue(l.containsKey("items"))
                assertTrue(l.containsKey("settings"))

                val settings = client.get("/api/v1/backups/settings") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, settings.status)

                // in-memory DB cannot be snapshotted to app backup file the same way in this test env
                val create = client.post("/api/v1/backups") {
                    header(HttpHeaders.Cookie, "alice_session=$cookie")
                    header(HttpHeaders.Origin, "http://localhost:3000")
                    header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
                    setBody("""{"kind":"app"}""")
                }
                // An in-memory database cannot be snapshotted: the record is created and marked failed, with an error saying why.
                assertEquals(HttpStatusCode.OK, create.status)
                assertTrue(create.bodyAsText().contains("\"status\":\"failed\""))
            }
        } finally { app.close() }
    }

    @Test
    fun `admin support state is readable by admin`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val cookie = registerAndCookie()
                val support = client.get("/api/v1/admin/support") { header(HttpHeaders.Cookie, "alice_session=$cookie") }
                assertEquals(HttpStatusCode.OK, support.status)
                val s = Json.parseToJsonElement(support.bodyAsText()).jsonObject
                assertTrue(s.containsKey("history"))
                assertTrue(s.containsKey("householdLog"))
                assertTrue(s.containsKey("operatorTrail"))
            }
        } finally { app.close() }
    }

    @Test
    fun `operator endpoints require bearer auth`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                val homes = client.get("/api/v1/operator/homes")
                assertEquals(HttpStatusCode.Unauthorized, homes.status)
            }
        } finally { app.close() }
    }

    @Test
    fun `history and energy routes require auth`() {
        val app = newApp()
        try {
            testApplication {
                application { configure(app.koin) }
                assertEquals(HttpStatusCode.Unauthorized, client.get("/api/v1/history/devices/x").status)
                assertEquals(HttpStatusCode.Unauthorized, client.get("/api/v1/energy/summary").status)
                assertEquals(HttpStatusCode.Unauthorized, client.get("/api/v1/energy/history").status)
                assertEquals(HttpStatusCode.Unauthorized, client.get("/api/v1/energy/devices").status)
                assertEquals(HttpStatusCode.Unauthorized, client.get("/api/v1/energy/pattern").status)
            }
        } finally { app.close() }
    }
}
