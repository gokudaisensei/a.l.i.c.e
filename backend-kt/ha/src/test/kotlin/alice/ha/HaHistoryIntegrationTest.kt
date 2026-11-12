package alice.ha

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.websocket.WebSockets
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue

class HaHistoryIntegrationTest {
    @Test
    fun `getHistory and getStatistics work against real HA`() {
        val url = System.getenv("HA_URL").orEmpty()
        val token = System.getenv("HA_TOKEN").orEmpty()
        Assumptions.assumeTrue(url.isNotBlank() && token.isNotBlank(), "HA_URL and HA_TOKEN are not set")

        val client = HttpClient(CIO) { install(WebSockets) }
        runBlocking {
            val gateway = HaWebSocketGateway(url, token, client)
            gateway.connect()
            val now = System.currentTimeMillis()
            val from = now - 3600_000
            val history = gateway.getHistory(listOf("sensor.sun_next_dawn"), from, now)
            println("history keys: ${history.keys}")
            val stats = gateway.getStatistics(listOf("sensor.sun_next_dawn"), from, now, "hour")
            println("stats keys: ${stats.keys}")
            gateway.disconnect()
        }
        client.close()
    }
}
