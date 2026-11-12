package alice.server

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.di.coreModule
import alice.server.api.ErrorEnvelope
import alice.server.di.serverModule
import alice.server.routes.HealthResponse
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test
import org.koin.dsl.koinApplication
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HealthTest {

    @Test
    fun `health is public and reports ok`() {
        val config = AppConfig(database = DatabaseConfig(path = ":memory:"))
        val koin = koinApplication { modules(coreModule(config), serverModule()) }.koin

        try {
            testApplication {
                application { configure(koin) }

                val response = client.get("/health")

                assertEquals(HttpStatusCode.OK, response.status)
                val body = Json.decodeFromString<HealthResponse>(response.bodyAsText())
                assertEquals("ok", body.status)
                assertTrue(body.uptime >= 0.0)
            }
        } finally {
            koin.close()
        }
    }

    @Test
    fun `unknown routes answer with the error envelope shape`() {
        val config = AppConfig(database = DatabaseConfig(path = ":memory:"))
        val koin = koinApplication { modules(coreModule(config), serverModule()) }.koin

        try {
            testApplication {
                application { configure(koin) }

                val response = client.get("/nope")

                assertEquals(HttpStatusCode.NotFound, response.status)
                val body = Json.decodeFromString<ErrorEnvelope>(response.bodyAsText())
                assertEquals("not_found", body.error.code)
            }
        } finally {
            koin.close()
        }
    }
}
