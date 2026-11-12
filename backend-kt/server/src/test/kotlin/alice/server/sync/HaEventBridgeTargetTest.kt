package alice.server.sync

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.di.coreModule
import alice.core.events.EventBus
import alice.core.events.PresenceChanged
import alice.ha.FakeGateway
import alice.ha.HaEntityState
import alice.server.di.serverModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.koin.dsl.koinApplication
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals

class HaEventBridgeTargetTest {
    @Test
    fun `presence from an unlinked person goes to the household that owns the connection, not the first one`() {
        val app = koinApplication { modules(coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"))), serverModule()) }
        try {
            val koin = app.koin
            koin.get<Database>().write {
                identityQueries.insertUser("u1", "A", 1)
                identityQueries.insertHousehold("h1", "First", 1); identityQueries.insertHouseholdSettings("h1")
                identityQueries.insertHousehold("h2", "Second", 2); identityQueries.insertHouseholdSettings("h2")
                identityQueries.insertHaConnection("c2", "h2", "HA", "http://ha", "tok", null, "connected", 1, 1)
            }
            val seen = CopyOnWriteArrayList<PresenceChanged>()
            CoroutineScope(Dispatchers.Default).launch { koin.get<EventBus>().events.collect { if (it is PresenceChanged) seen += it } }
            koin.get<HaEventBridge>().start()
            val gw = koin.get<FakeGateway>()
            runBlocking {
                delay(200) // the bridge subscribes asynchronously
                gw.emitState(HaEntityState("person.sam", "home", last_changed = "2026-01-01T00:00:00Z"), HaEntityState("person.sam", "not_home"))
                withTimeout(3000) { while (seen.isEmpty()) delay(10) }
            }
            assertEquals("h2", seen.first().householdId)
        } finally { app.close() }
    }
}
