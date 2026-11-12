package alice.server.realtime

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.InProcessEventBus
import alice.core.time.SystemTimeProvider
import alice.server.auth.SessionContext
import alice.server.commands.CommandAppEvent
import alice.server.commands.CommandSource
import alice.server.commands.CommandState
import alice.server.commands.DeviceCommand
import alice.server.households.HouseholdService
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
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

class RealtimeHubTest {
    private val time = SystemTimeProvider
    private val json = Json { ignoreUnknownKeys = true }

    private data class Env(val db: Database, val hs: HouseholdService, val bus: InProcessEventBus, val hub: RealtimeHub)

    private fun newHub(sweepMs: Long = RealtimeHub.SWEEP_MS, sendTimeoutMs: Long = RealtimeHub.SEND_TIMEOUT_MS): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        val hs = HouseholdService(db, time)
        db.write {
            identityQueries.insertUser("u1", "User One", System.currentTimeMillis())
            identityQueries.insertUserPreferences("u1")
            hs.createHousehold(this, "Home", "u1")
        }
        val bus = InProcessEventBus()
        val hub = RealtimeHub(bus, hs, auth = null, things = null, stateCache = null, time = time, json = json, sweepMs = sweepMs, sendTimeoutMs = sendTimeoutMs)
        return Env(db, hs, bus, hub)
    }

    private inner class FakeSocket(override val id: String) : ClientSocket {
        val sent = ConcurrentLinkedQueue<String>()
        val closed = ConcurrentLinkedQueue<Pair<Int, String>>()
        override suspend fun send(msg: JsonObject) { sent.add(msg.toString()) }
        override suspend fun close(code: Int, reason: String) { closed.add(code to reason) }
        override fun bufferedAmount(): Int = 0
        fun msgs(): List<JsonObject> = sent.map { json.parseToJsonElement(it).jsonObject }
        fun types(): List<String> = msgs().map { it["type"]!!.jsonPrimitive.content }
    }

    private fun session(userId: String = "u1", sid: String = "ses1") = SessionContext(sid, userId, 1000, false, false)

    @Test
    fun `connect sends hello with user role and resources`() = runBlocking {
        val env = newHub()
        val member = env.hs.getMembership("u1")!!
        val socket = FakeSocket("s1")
        assertTrue(env.hub.connect(socket, session(), member))
        val hello = socket.msgs().first { it["type"]!!.jsonPrimitive.content == "hello" }
        val data = hello["data"]!!.jsonObject
        assertEquals("u1", data["userId"]!!.jsonPrimitive.content)
        assertEquals("admin", data["role"]!!.jsonPrimitive.content)
        assertTrue(data["resources"].toString().contains("devices"))
    }

    @Test
    fun `ping returns pong with requestId`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.receive("s1", """{"type":"ping","requestId":"r1"}""")
        delay(50)
        val pong = socket.msgs().first { it["type"]!!.jsonPrimitive.content == "pong" }
        assertEquals("r1", pong["requestId"]!!.jsonPrimitive.content)
    }

    @Test
    fun `subscribe and unsubscribe work`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.receive("s1", """{"type":"subscribe","resource":"devices","requestId":"r1"}""")
        delay(50)
        val sub = socket.msgs().first { it["type"]!!.jsonPrimitive.content == "subscribed" }
        assertEquals("devices", sub["data"]!!.jsonObject["resource"]!!.jsonPrimitive.content)
        assertEquals("r1", sub["requestId"]!!.jsonPrimitive.content)
        env.hub.receive("s1", """{"type":"unsubscribe","resource":"devices","requestId":"r2"}""")
        delay(50)
        assertTrue(socket.types().contains("unsubscribed"))
    }

    @Test
    fun `unknown resource and validation errors`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.receive("s1", """{"type":"subscribe","resource":"nope"}""")
        env.hub.receive("s1", """{"type":"subscribe","resource":"device"}""")
        env.hub.receive("s1", """{"type":"subscribe","resource":"devices","id":"x"}""")
        delay(50)
        val errs = socket.msgs().filter { it["type"]!!.jsonPrimitive.content == "error" }.map { it["data"]!!.jsonObject["code"]!!.jsonPrimitive.content }
        assertTrue(errs.contains("unknown_resource"))
        assertTrue(errs.contains("validation_error"))
    }

    @Test
    fun `bad json and unknown message type return errors`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.receive("s1", "{not json")
        env.hub.receive("s1", """{"foo":"bar"}""")
        env.hub.receive("s1", """{"type":"frobnicate"}""")
        delay(50)
        val errs = socket.msgs().filter { it["type"]!!.jsonPrimitive.content == "error" }.map { it["data"]!!.jsonObject["code"]!!.jsonPrimitive.content }
        assertTrue(errs.contains("bad_message"))
        assertTrue(errs.contains("unknown_message_type"))
    }

    @Test
    fun `rate limiting returns rate_limited error`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        repeat(61) { env.hub.receive("s1", """{"type":"ping"}""") }
        delay(100)
        assertTrue(socket.msgs().any { it["type"]!!.jsonPrimitive.content == "error" && it["data"]!!.jsonObject["code"]!!.jsonPrimitive.content == "rate_limited" })
    }

    @Test
    fun `connection limit enforced per user`() = runBlocking {
        val env = newHub()
        val member = env.hs.getMembership("u1")!!
        repeat(10) { i -> assertTrue(env.hub.connect(FakeSocket("s$i"), SessionContext("ses$i", "u1", 1000, false, false), member)) }
        val s11 = FakeSocket("s11")
        assertFalse(env.hub.connect(s11, SessionContext("ses11", "u1", 1000, false, false), member))
        assertTrue(s11.closed.any { it.first == 4429 })
    }

    @Test
    fun `sweep drops clients with ended sessions or lost membership`() = runBlocking {
        val env = newHub()
        val member = env.hs.getMembership("u1")!!
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), member)
        val memberId = env.hs.getMembership("u1")!!.memberId
        env.db.write { identityQueries.updateHouseholdMemberExpiry(0L, memberId) }
        env.hub.sweep()
        assertEquals(0, env.hub.connectionCount)
        assertTrue(socket.closed.any { it.first == 4401 })
    }

    @Test
    fun `closeAll closes clients with 1001`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.closeAll("bye")
        assertEquals(0, env.hub.connectionCount)
        assertTrue(socket.closed.any { it.first == 1001 })
    }

    @Test
    fun `command events delivered to admins and filtered for users`() = runBlocking {
        val env = newHub()
        // admin u1
        val adminSocket = FakeSocket("sa")
        env.hub.connect(adminSocket, session("u1", "sa1"), env.hs.getMembership("u1")!!)
        env.hub.receive("sa", """{"type":"subscribe","resource":"commands"}""")
        // member u2
        env.db.write {
            identityQueries.insertUser("u2", "User Two", System.currentTimeMillis())
            identityQueries.insertUserPreferences("u2")
            identityQueries.insertHouseholdMember("m2", env.hs.getMembership("u1")!!.householdId, "u2", "member", null, System.currentTimeMillis())
        }
        val m2 = env.hs.getMembership("u2")!!
        val u2Socket = FakeSocket("sb")
        env.hub.connect(u2Socket, session("u2", "sb1"), m2)
        env.hub.receive("sb", """{"type":"subscribe","resource":"commands"}""")
        delay(50)

        val cmd = DeviceCommand("cmd1", m2.householdId, null, "light.x", "light", "turn_on", emptyMap(), CommandState.CONFIRMED, null, null, "u1", CommandSource.USER, null, null, null, 1, null, null, 2, null, null, null, null)
        env.bus.publish(CommandAppEvent("command.confirmed", m2.householdId, cmd))
        delay(100)
        assertTrue(adminSocket.types().contains("command.confirmed"))
        assertFalse(u2Socket.types().contains("command.confirmed")) // not requested by u2 and not admin

        val cmd2 = cmd.copy(id = "cmd2", requestedBy = "u2")
        env.bus.publish(CommandAppEvent("command.confirmed", m2.householdId, cmd2))
        delay(100)
        assertTrue(u2Socket.types().contains("command.confirmed"))
    }

    @Test
    fun `household mode changed pushed to household subscribers`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.receive("s1", """{"type":"subscribe","resource":"household"}""")
        delay(50)
        env.bus.publish(alice.core.events.HouseholdModeChanged(env.hs.getMembership("u1")!!.householdId, null, "away", "home", "u1"))
        delay(100)
        assertTrue(socket.types().contains("household.mode_changed"))
    }

    @Test
    fun `presence changed pushed only to members with members view`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        env.hub.receive("s1", """{"type":"subscribe","resource":"household"}""")
        delay(50)
        env.bus.publish(alice.core.events.PresenceChanged(env.hs.getMembership("u1")!!.householdId, null, "u1", "person.u1", true))
        delay(100)
        assertTrue(socket.types().contains("presence.changed"))
    }

    @Test
    fun `a client whose membership ends is dropped by the periodic sweep`() = runBlocking {
        val env = newHub(sweepMs = 20)
        val member = env.hs.getMembership("u1")!!
        val socket = FakeSocket("s1")
        assertTrue(env.hub.connect(socket, session(), member))
        env.db.write { identityQueries.deleteHouseholdMemberById(member.memberId) }
        kotlinx.coroutines.withTimeout(3000) { while (socket.closed.isEmpty()) delay(10) }
        assertEquals(4401, socket.closed.first().first)
        assertEquals(0, env.hub.connectionCount)
    }

    @Test
    fun `a client that is still a member is not dropped by the sweep`() = runBlocking {
        val env = newHub(sweepMs = 20)
        val socket = FakeSocket("s1")
        env.hub.connect(socket, session(), env.hs.getMembership("u1")!!)
        delay(200)
        assertTrue(socket.closed.isEmpty())
        assertEquals(1, env.hub.connectionCount)
    }

    /** A socket whose connection never takes another message, like a phone that lost its network without closing. */
    private inner class StuckSocket(override val id: String) : ClientSocket {
        val closed = ConcurrentLinkedQueue<Pair<Int, String>>()
        val helloSent = java.util.concurrent.atomic.AtomicBoolean()
        override suspend fun send(msg: JsonObject) {
            if (msg["type"]?.jsonPrimitive?.content == "hello") { helloSent.set(true); return }
            kotlinx.coroutines.awaitCancellation()
        }
        override suspend fun close(code: Int, reason: String) { closed.add(code to reason) }
        override fun bufferedAmount(): Int = 0
    }

    @Test
    fun `a stuck client is dropped and does not hold up a healthy one`() = runBlocking {
        val env = newHub(sendTimeoutMs = 200)
        val stuck = StuckSocket("stuck"); val healthy = FakeSocket("healthy")
        val member = env.hs.getMembership("u1")!!
        env.hub.connect(stuck, session(sid = "s1"), member); env.hub.connect(healthy, session(sid = "s2"), member)
        env.hub.receive("stuck", """{"type":"subscribe","resource":"devices"}""")
        env.hub.receive("healthy", """{"type":"subscribe","resource":"devices"}""")
        delay(50)
        env.bus.publish(alice.core.events.ThingsChanged(householdId = member.householdId, reason = "test"))
        kotlinx.coroutines.withTimeout(3000) { while (!healthy.types().contains("devices.changed")) delay(20) }
        kotlinx.coroutines.withTimeout(3000) { while (stuck.closed.isEmpty()) delay(20) }
        assertEquals(1013, stuck.closed.first().first)
        assertEquals(1, env.hub.connectionCount, "only the healthy client is left")
    }

    @Test
    fun `when the queue overflows, replaceable snapshots go before messages that must arrive`() = runBlocking {
        val env = newHub()
        val socket = FakeSocket("s1")
        val c = WsClient(socket, "u1", "ses1", "h1", "admin", 0L)
        repeat(100) { env.hub.enqueue(c, "notification.created", null) }                        // must arrive
        repeat(250) { n -> env.hub.enqueue(c, "entity.updated", null, "entity:light.$n") }       // replaceable
        assertEquals(RealtimeHub.QUEUE_LIMIT, c.queue.size)
        assertEquals(100, c.queue.count { it.type == "notification.created" }, "no notification may be pushed out by snapshots")
    }

    @Test
    fun `ten simultaneous connections for one user are capped at the limit`() {
        val env = newHub()
        val member = runBlocking { env.hs.getMembership("u1")!! }
        val pool = java.util.concurrent.Executors.newFixedThreadPool(16)
        val go = java.util.concurrent.CountDownLatch(1)
        val results = (1..40).map { n -> pool.submit<Boolean> { go.await(); env.hub.connect(FakeSocket("c$n"), session(sid = "s$n"), member) } }
        go.countDown()
        val accepted = results.count { it.get() }
        pool.shutdown()
        assertEquals(RealtimeHub.MAX_CONNECTIONS_PER_USER, accepted)
        assertEquals(RealtimeHub.MAX_CONNECTIONS_PER_USER, env.hub.connectionCount)
    }

    @Test
    fun `stopping the hub tells clients the server is going away`() = runBlocking {
        val env = newHub()
        val a = FakeSocket("a")
        env.hub.connect(a, session(), env.hs.getMembership("u1")!!)
        env.hub.stop()
        assertEquals(1001, a.closed.first().first)
        assertEquals(0, env.hub.connectionCount)
    }
}
