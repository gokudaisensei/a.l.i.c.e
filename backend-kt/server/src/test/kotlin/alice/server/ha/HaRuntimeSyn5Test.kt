package alice.server.ha

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.InProcessEventBus
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.ha.SwitchableGateway
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class HaRuntimeSyn5Test {
    @Test
    fun `status reports cache size and syncedAt after connecting and null before`() = runBlocking<Unit> {
        val db = Database(DatabaseFactory.open(":memory:"))
        val fake = FakeGateway()
        val real = FakeGateway()
        val switch = SwitchableGateway(fake)
        val cache = StateCache()
        val bus = InProcessEventBus()
        val scope = CoroutineScope(Dispatchers.Default)
        val vault = alice.core.security.TokenVault.ephemeral()
        val built = mutableListOf<Pair<String, String>>()
        val runtime = HaRuntime(db, switch, cache, bus, SystemTimeProvider, vault, { url, token -> built += url to token; real }, { 10L })
        try {
            val t = System.currentTimeMillis()
            db.write {
                identityQueries.insertUser("u1", "A", t)
                identityQueries.insertUserPreferences("u1")
                identityQueries.insertHousehold("h1", "Home", t)
                identityQueries.insertHouseholdSettings("h1")
                identityQueries.insertHaConnection("hac1", "h1", "HA", "http://ha.local:8123", "tok", null, "disconnected", t, t)
            }
            real.states.add(HaEntityState("light.a", "off", mapOf("brightness" to JsonPrimitive(1))))
            real.states.add(HaEntityState("light.b", "on", mapOf("brightness" to JsonPrimitive(2))))

            val serviceBefore = HaConnectionAdminService(db, alice.core.config.AppConfig(), SystemTimeProvider, runtime, vault, cache)
            assertEquals(0, serviceBefore.status("h1").entities)
            assertNull(serviceBefore.status("h1").syncedAt)
            assertNull(runtime.lastSyncedAt)

            runtime.start()
            withTimeout(3000) { while (db.read { identityQueries.selectHaConnectionById("hac1").executeAsOne().status } != "connected") delay(10) }
            assertEquals(2, cache.size)
            assertNotNull(runtime.lastSyncedAt)

            val serviceAfter = HaConnectionAdminService(db, alice.core.config.AppConfig(), SystemTimeProvider, runtime, vault, cache)
            assertEquals(2, serviceAfter.status("h1").entities)
            assertEquals(runtime.lastSyncedAt, serviceAfter.status("h1").syncedAt)
        } finally {
            runtime.close()
            scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
            db.close()
        }
    }
}
