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
import org.koin.dsl.koinApplication
import kotlin.test.assertTrue

class HaLiveIntegrationTest {
    @Test
    fun `real HA things build and device routes work`() {
        val url = System.getenv("HA_URL").orEmpty()
        val token = System.getenv("HA_TOKEN").orEmpty()
        Assumptions.assumeTrue(url.isNotBlank() && token.isNotBlank(), "HA_URL and HA_TOKEN are not set")

        val client = HttpClient(CIO) { install(WebSockets) }
        runBlocking {
            val gateway = HaWebSocketGateway(url, token, client)
            gateway.connect()
            val inv = alice.ha.buildInventory(alice.ha.RawDiscovery(
                areas = gateway.getAreas(),
                devices = gateway.getDevices(),
                entityRegistry = gateway.getEntityRegistry(),
                states = gateway.getStates(),
            ))
            val things = alice.ha.ThingBuilder.buildThings(inv, "conn-1")
            assertTrue(things.isNotEmpty(), "expected things from real HA")
            assertTrue(inv.entities.isNotEmpty(), "expected entities")
            println("HA integration: areas=${inv.areas.size} devices=${inv.devices.size} entities=${inv.entities.size} things=${things.size}")
            gateway.disconnect()
        }
        client.close()
    }
}
