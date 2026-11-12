package alice.server.realtime

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.AlertCreated
import alice.core.events.ConnectionConnected
import alice.core.events.ConnectionDisconnected
import alice.core.events.InProcessEventBus
import alice.core.events.InsightsChanged
import alice.core.events.NotificationCreated
import alice.core.events.ThingsChanged
import alice.core.time.SystemTimeProvider
import alice.server.auth.SessionContext
import alice.server.households.HouseholdService
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentLinkedQueue

class RealtimeHubExtraTest {
    private val time = SystemTimeProvider
    private val json = Json { ignoreUnknownKeys = true }

    private data class Env(val db: Database, val hs: HouseholdService, val bus: InProcessEventBus, val hub: RealtimeHub)
    private fun newHub(): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        val hs = HouseholdService(db, time)
        db.write {
            identityQueries.insertUser("u1", "Admin", System.currentTimeMillis())
            identityQueries.insertUserPreferences("u1")
            hs.createHousehold(this, "Home", "u1")
            identityQueries.insertUser("u2", "Member", System.currentTimeMillis())
            identityQueries.insertUserPreferences("u2")
            identityQueries.insertHouseholdMember("m2", hs.getMembership("u1")!!.householdId, "u2", "member", null, System.currentTimeMillis())
            identityQueries.insertUser("u3", "Guest", System.currentTimeMillis())
            identityQueries.insertUserPreferences("u3")
            identityQueries.insertHouseholdMember("m3", hs.getMembership("u1")!!.householdId, "u3", "guest", null, System.currentTimeMillis())
        }
        val bus = InProcessEventBus()
        val hub = RealtimeHub(bus, hs, time = time, json = json)
        return Env(db, hs, bus, hub)
    }

    private inner class FakeSocket(override val id: String) : ClientSocket {
        val sent = ConcurrentLinkedQueue<String>()
        val closed = ConcurrentLinkedQueue<Pair<Int, String>>()
        override suspend fun send(msg: JsonObject) { sent.add(msg.toString()) }
        override suspend fun close(code: Int, reason: String) { closed.add(code to reason) }
        override fun bufferedAmount(): Int = 0
        fun msgs() = sent.map { json.parseToJsonElement(it).jsonObject }
        fun types() = msgs().map { it["type"]!!.jsonPrimitive.content }
    }

    private fun session(userId: String, sid: String) = SessionContext(sid, userId, 1000, false, false)

    @Test
    fun `hello includes protocolVersion`() = runBlocking {
        val env = newHub()
        val s = FakeSocket("s1")
        env.hub.connect(s, session("u1", "sa"), env.hs.getMembership("u1")!!)
        val hello = s.msgs().first { it["type"]!!.jsonPrimitive.content == "hello" }
        assertEquals(1, hello["data"]!!.jsonObject["protocolVersion"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `insights changed only for household subscribers with mode change`() = runBlocking {
        val env = newHub()
        val hid = env.hs.getMembership("u1")!!.householdId
        val admin = FakeSocket("a"); env.hub.connect(admin, session("u1", "sa"), env.hs.getMembership("u1")!!); env.hub.receive("a", """{"type":"subscribe","resource":"household"}""")
        val guest = FakeSocket("g"); env.hub.connect(guest, session("u3", "sg"), env.hs.getMembership("u3")!!); env.hub.receive("g", """{"type":"subscribe","resource":"household"}""")
        delay(60)
        env.bus.publish(InsightsChanged(hid))
        delay(200)
        assertTrue(admin.types().contains("insights.changed"))
        assertFalse(guest.types().contains("insights.changed"))
    }

    @Test
    fun `connection events only for ha manage subscribers`() = runBlocking {
        val env = newHub()
        val hid = env.hs.getMembership("u1")!!.householdId
        val admin = FakeSocket("a"); env.hub.connect(admin, session("u1", "sa"), env.hs.getMembership("u1")!!); env.hub.receive("a", """{"type":"subscribe","resource":"household"}""")
        val member = FakeSocket("m"); env.hub.connect(member, session("u2", "sm"), env.hs.getMembership("u2")!!); env.hub.receive("m", """{"type":"subscribe","resource":"household"}""")
        delay(60)
        env.bus.publish(ConnectionConnected(hid, null, "c1", "connected"))
        env.bus.publish(ConnectionDisconnected(hid, null, "c1", "disconnected", "boom"))
        delay(200)
        assertTrue(admin.types().contains("connection.connected"))
        assertTrue(admin.types().contains("connection.disconnected"))
        assertFalse(member.types().contains("connection.connected"))
        assertFalse(member.types().contains("connection.disconnected"))
    }

    @Test
    fun `alerts and notifications filtered correctly`() = runBlocking {
        val env = newHub()
        val hid = env.hs.getMembership("u1")!!.householdId
        val admin = FakeSocket("a"); env.hub.connect(admin, session("u1", "sa"), env.hs.getMembership("u1")!!); env.hub.receive("a", """{"type":"subscribe","resource":"alerts"}"""); env.hub.receive("a", """{"type":"subscribe","resource":"notifications"}""")
        val member = FakeSocket("m"); env.hub.connect(member, session("u2", "sm"), env.hs.getMembership("u2")!!); env.hub.receive("m", """{"type":"subscribe","resource":"notifications"}""")
        delay(60)
        env.bus.publish(AlertCreated(hid, null, "al1", mapOf("title" to "Hi")))
        env.bus.publish(NotificationCreated(hid, null, "u2", "n1", mapOf("title" to "Note")))
        delay(200)
        assertTrue(admin.types().contains("alert.created"))
        assertFalse(admin.types().contains("notification.created")) // targeted to u2
        assertTrue(member.types().contains("notification.created"))
    }

    @Test
    fun `devices changed coalesced in queue`() = runBlocking {
        val env = newHub()
        val hid = env.hs.getMembership("u1")!!.householdId
        val s = FakeSocket("s1"); env.hub.connect(s, session("u1", "sa"), env.hs.getMembership("u1")!!); env.hub.receive("s1", """{"type":"subscribe","resource":"devices"}""")
        delay(60)
        repeat(5) { env.bus.publish(ThingsChanged(hid, null, "inventory")) }
        delay(250)
        val count = s.types().count { it == "devices.changed" }
        assertTrue(count >= 1)
        assertTrue(count <= 2) // coalesced by key in queue/flush window
    }
}
