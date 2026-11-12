package alice.server.http

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.di.coreModule
import alice.server.auth.AuthService
import alice.server.di.serverModule
import alice.server.households.HouseholdService
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.server.application.install
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SessionPluginTest {
    @Test
    fun `installing without auth and households fails at startup and names them`() {
        val error = assertFailsWith<IllegalStateException> {
            testApplication {
                application { install(SessionPlugin) }
            }
        }
        assertTrue(error.message!!.contains("auth"), error.message)
        assertTrue(error.message!!.contains("households"), error.message)
    }

    @Test
    fun `an api request works when both settings are present`() {
        val app = koinApplication {
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
        try {
            testApplication {
                application {
                    install(SessionPlugin) {
                        auth = app.koin.get<AuthService>()
                        households = app.koin.get<HouseholdService>()
                    }
                    routing { get("/api/v1/ping") { call.respondText("ok") } }
                }
                val response = client.get("/api/v1/ping")
                assertEquals("ok", response.bodyAsText())
            }
        } finally {
            app.close()
        }
    }
}
