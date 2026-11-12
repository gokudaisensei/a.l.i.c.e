package alice.server.ha

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.AppEvent
import alice.core.events.EntityStateChanged
import alice.core.events.InProcessEventBus
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaAuthError
import alice.ha.HaConnectionState
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.ha.SwitchableGateway
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HaRuntimeTest {
    private class Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        val fake = FakeGateway()
        val real = FakeGateway()
        val switch = SwitchableGateway(fake)
        val cache = StateCache()
        val bus = InProcessEventBus()
        val seen = CopyOnWriteArrayList<AppEvent>()
        val built = CopyOnWriteArrayList<Pair<String, String>>()
        val scope = CoroutineScope(Dispatchers.Default)
        val vault = alice.core.security.TokenVault.ephemeral()
        val runtime = HaRuntime(db, switch, cache, bus, SystemTimeProvider, vault, { url, token -> built += url to token; real }, { 10L })

        init {
            scope.launch { bus.events.collect { seen += it } }
            db.write {
                identityQueries.insertUser("u1", "A", 1)
                identityQueries.insertUserPreferences("u1")
                identityQueries.insertHousehold("h1", "Home", 1)
                identityQueries.insertHouseholdSettings("h1")
                identityQueries.insertHaConnection("hac1", "h1", "HA", "http://ha.local:8123", "tok", null, "disconnected", 1, 1)
            }
            real.states.add(HaEntityState("light.a", "off", mapOf("brightness" to JsonPrimitive(1))))
        }

        fun status(): String = db.read { identityQueries.selectHaConnectionById("hac1").executeAsOne().status }
        fun lastError(): String? = db.read { identityQueries.selectHaConnectionById("hac1").executeAsOne().last_error }
        fun close() { runtime.close(); scope.coroutineContext[kotlinx.coroutines.Job]?.cancel() }
    }

    private fun until(what: String, check: () -> Boolean) = runBlocking {
        withTimeout(3000) { while (!check()) delay(10) }
    }

    @Test
    fun `connects, loads the cache, records status and follows state changes`() {
        val e = Env()
        try {
            e.runtime.start()
            until("connected") { e.status() == "connected" }
            assertEquals("http://ha.local:8123" to "tok", e.built.single())
            assertEquals("off", e.cache.get("light.a")!!.state)
            assertTrue(e.switch.delegate === e.real, "the app's gateway now points at the real connection")
            assertNotNull(e.db.read { identityQueries.selectHaConnectionById("hac1").executeAsOne().ha_version })

            e.real.emitState(HaEntityState("light.a", "on", mapOf("brightness" to JsonPrimitive(200))), HaEntityState("light.a", "off"))
            until("cache updated") { e.cache.get("light.a")?.state == "on" }
            until("event published") { e.seen.any { it is EntityStateChanged && it.entityId == "light.a" && it.currentState == "on" && it.householdId == "h1" } }
        } finally { e.close() }
    }

    @Test
    fun `a token stored in the clear is encrypted in place and still used`() {
        val e = Env()
        try {
            e.runtime.start()
            until("connected") { e.status() == "connected" }
            assertEquals("http://ha.local:8123" to "tok", e.built.single())
            val stored = e.db.read { identityQueries.selectHaConnectionById("hac1").executeAsOne().operational_token_enc }
            assertTrue(e.vault.isSealed(stored))
            assertEquals("tok", e.vault.open(stored))
        } finally { e.close() }
    }

    @Test
    fun `a dropped connection is reconnected`() {
        val e = Env()
        try {
            e.runtime.start()
            until("connected") { e.status() == "connected" }
            e.real.setStatus(HaConnectionState.DISCONNECTED)
            until("reconnected") { e.real.connectAttempts >= 2 && e.status() == "connected" }
        } finally { e.close() }
    }

    @Test
    fun `a rejected token is recorded and not retried`() {
        val e = Env()
        try {
            e.real.connectFailures.add(HaAuthError())
            e.runtime.start()
            until("error") { e.status() == "error" }
            assertEquals("Home Assistant rejected the access token", e.lastError())
            runBlocking { delay(150) }
            assertEquals(1, e.real.connectAttempts)
        } finally { e.close() }
    }

    @Test
    fun `a failing connect is retried until it works`() {
        val e = Env()
        try {
            e.real.connectFailures.add(java.io.IOException("unreachable"))
            e.runtime.start()
            until("connected") { e.status() == "connected" }
            assertEquals(2, e.real.connectAttempts)
        } finally { e.close() }
    }

    @Test
    fun `removing the connection empties the cache and stops`() {
        val e = Env()
        try {
            e.runtime.start()
            until("connected") { e.status() == "connected" }
            e.db.write { identityQueries.deleteHaConnectionById("hac1") }
            e.runtime.start()
            assertEquals(0, e.cache.size)
        } finally { e.close() }
    }

    @Test
    fun `with no connection configured nothing happens`() {
        val e = Env()
        try {
            e.db.write { identityQueries.deleteHaConnectionById("hac1") }
            e.runtime.start()
            runBlocking { delay(50) }
            assertTrue(e.built.isEmpty())
            assertTrue(e.switch.delegate === e.fake)
        } finally { e.close() }
    }
}
