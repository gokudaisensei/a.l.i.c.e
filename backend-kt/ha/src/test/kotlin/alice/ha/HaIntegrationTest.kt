package alice.ha

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.WebSockets
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue

class HaIntegrationTest {
    @Test
    fun `connects to a real Home Assistant and discovers entities`() {
        val url = System.getenv("HA_URL").orEmpty()
        val token = System.getenv("HA_TOKEN").orEmpty()
        Assumptions.assumeTrue(url.isNotBlank() && token.isNotBlank(), "HA_URL and HA_TOKEN are not set")

        val client = HttpClient { install(WebSockets) }
        val gateway = HaWebSocketGateway(url, token, client)
        kotlinx.coroutines.runBlocking {
            gateway.connect()
            val states = gateway.getStates()
            assertTrue(states.isNotEmpty(), "expected at least one state")
            val areas = gateway.getAreas()
            println("states=${states.size} areas=${areas.size}")
            gateway.disconnect()
        }
        client.close()
    }
}

