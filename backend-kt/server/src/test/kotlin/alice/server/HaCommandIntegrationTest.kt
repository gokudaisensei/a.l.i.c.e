package alice.server

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.core.di.coreModule
import alice.ha.HaWebSocketGateway
import alice.server.di.serverModule
import alice.server.things.ThingsService
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue

class HaCommandIntegrationTest {
    @Test
    fun `command execution against real HA`() {
        val url = System.getenv("HA_URL").orEmpty()
        val token = System.getenv("HA_TOKEN").orEmpty()
        Assumptions.assumeTrue(url.isNotBlank() && token.isNotBlank(), "HA_URL and HA_TOKEN are not set")

        val client = HttpClient(CIO) { install(WebSockets) }
        runBlocking {
            val gateway = HaWebSocketGateway(url, token, client)
            gateway.connect()
            val states = gateway.getStates()
            assertTrue(states.isNotEmpty())
            // Try calling a service
            val result = gateway.callService(alice.ha.HaServiceCallInput("input_boolean", "turn_on", target = alice.ha.HaServiceTarget(entity_id = listOf("input_boolean.test_switch"))))
            println("contextId: ${result.contextId}")
            gateway.disconnect()
        }
        client.close()
    }
}
