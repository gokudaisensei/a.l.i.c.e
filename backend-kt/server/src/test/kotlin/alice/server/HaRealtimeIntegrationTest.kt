package alice.server

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.InProcessEventBus
import alice.core.time.SystemTimeProvider
import alice.ha.EntityStateChangedEvent
import alice.ha.HaWebSocketGateway
import alice.ha.NormalizedState
import alice.ha.StateCache
import alice.ha.StateNormalizer
import alice.server.auth.SessionContext
import alice.server.households.HouseholdService
import alice.server.realtime.ClientSocket
import alice.server.realtime.RealtimeHub
import alice.server.things.ThingsService
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.websocket.WebSockets
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.test.assertTrue

class HaRealtimeIntegrationTest {
    private val json = Json { ignoreUnknownKeys = true }

    private inner class FakeSocket(override val id: String) : ClientSocket {
        val sent = ConcurrentLinkedQueue<String>()
        override suspend fun send(msg: JsonObject) { sent.add(msg.toString()) }
        override suspend fun close(code: Int, reason: String) {}
        override fun bufferedAmount(): Int = 0
        fun types() = sent.map { json.parseToJsonElement(it).jsonObject["type"]!!.jsonPrimitive.content }
        fun msgs() = sent.map { json.parseToJsonElement(it).jsonObject }
    }

    @Test
    fun `realtime pushes entity update for real HA thing`() {
        val url = System.getenv("HA_URL").orEmpty()
        val token = System.getenv("HA_TOKEN").orEmpty()
        Assumptions.assumeTrue(url.isNotBlank() && token.isNotBlank(), "HA_URL and HA_TOKEN are not set")

        val client = HttpClient(CIO) { install(WebSockets) }
        runBlocking {
            val gateway = HaWebSocketGateway(url, token, client)
            gateway.connect()
            try {
                val db = Database(DatabaseFactory.open(":memory:"))
                val hs = HouseholdService(db, SystemTimeProvider)
                db.write {
                    identityQueries.insertUser("u1", "Admin", System.currentTimeMillis())
                    identityQueries.insertUserPreferences("u1")
                    hs.createHousehold(this, "Home", "u1")
                }
                val membership = hs.getMembership("u1")!!
                val thingsSvc = ThingsService(gateway, db, hs)
                val things = thingsSvc.things(membership.householdId, includeHidden = true)
                Assumptions.assumeTrue(things.isNotEmpty(), "need HA things")
                val thing = things.first { it.entityIds.isNotEmpty() }
                val entityId = thing.entityIds.first()
                val domain = entityId.substringBefore('.')

                val bus = InProcessEventBus()
                val cache = StateCache()
                val hub = RealtimeHub(bus, hs, null, thingsSvc, cache, SystemTimeProvider, json)
                val socket = FakeSocket("s1")
                hub.connect(socket, SessionContext("ses1", "u1", 1000, false, false), membership)
                hub.receive("s1", """{"type":"subscribe","resource":"devices"}""")
                delay(120)

                val normalized = StateNormalizer.normalize(domain, "on", emptyMap())
                val ev = EntityStateChangedEvent(
                    householdId = membership.householdId,
                    connectionId = "conn-1",
                    timestamp = java.time.Instant.now().toString(),
                    entityId = entityId,
                    previousState = "off",
                    currentState = "on",
                    attributes = emptyMap(),
                    normalized = normalized,
                    lastChanged = java.time.Instant.now().toString(),
                    lastUpdated = java.time.Instant.now().toString(),
                    contextId = "ctx",
                    contextParentId = null,
                    contextUserId = null,
                )
                bus.publish(ev)
                delay(250)

                assertTrue(socket.types().contains("entity.updated"), "expected entity.updated, got ${socket.types()}")
                val upd = socket.msgs().first { it["type"]!!.jsonPrimitive.content == "entity.updated" }
                assertTrue(upd["data"]!!.jsonObject["thingId"]!!.jsonPrimitive.content == thing.id)
                assertTrue(upd["data"]!!.jsonObject["entityId"]!!.jsonPrimitive.content == entityId)
            } finally {
                gateway.disconnect()
            }
        }
        client.close()
    }
}
