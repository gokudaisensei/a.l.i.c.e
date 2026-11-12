package alice.server.commands

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.error.AppException
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaAreaRegistryEntry
import alice.ha.HaDeviceRegistryEntry
import alice.ha.HaEntityRegistryEntry
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.server.households.HouseholdService
import alice.server.permissions.defaultSensitivityCheck
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

class UndoPolicyTest {
    private class Env(val executor: CommandExecutor, val db: Database)

    private fun env(): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            for ((id, role) in listOf("u1" to "admin", "u2" to "guest")) {
                identityQueries.insertUser(id, id, 1000); identityQueries.insertUserPreferences(id)
            }
            identityQueries.insertHousehold("h1", "Home", 1000); identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
            identityQueries.insertHouseholdMember("m2", "h1", "u2", "guest", null, 1000)
        }
        val hs = HouseholdService(db, SystemTimeProvider)
        val gw = FakeGateway()
        gw.areas.add(HaAreaRegistryEntry("a1", "Hall", null))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "dev1", area_id = "a1", identifiers = listOf(listOf("x", "dev1"))))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.one", device_id = "dev1", platform = "light", original_name = "Lamp"))
        val off = HaEntityState("light.one", "off", mapOf("friendly_name" to JsonPrimitive("Lamp")))
        gw.states.add(off)
        val cache = StateCache().apply { replaceAll(listOf(off)) }
        // Home Assistant would report the new state; the cache is what the executor watches for confirmation.
        gw.onCallService = { call ->
            val on = call.service == "turn_on"
            cache.apply(HaEntityState("light.one", if (on) "on" else "off", mapOf("friendly_name" to JsonPrimitive("Lamp"))), "light.one")
        }
        val things = ThingsService(gw, db, hs)
        val executor = CommandExecutor(InMemoryCommandStore(), gw, cache, hs, SystemTimeProvider, null, null, defaultSensitivityCheck, lazyOf(null), lazyOf(things))
        return Env(executor, db)
    }

    private fun turnOnAsGuest(e: Env): DeviceCommand = runBlocking {
        e.executor.execute(CommandInput("h1", "light.one", "turn_on", emptyMap(), Actor("u2", CommandSource.USER, false), confirmTimeoutMs = 500))
    }

    @Test
    fun `an undo is refused when the person who made the command can no longer see the device`() {
        val e = env()
        val cmd = turnOnAsGuest(e)
        assertEquals(CommandState.CONFIRMED, cmd.state)
        // The guest has no allow rule for the lamp, so it must not be touched on their behalf either.
        assertFailsWith<AppException> { runBlocking { e.executor.undo(cmd.id) } }
        assertEquals(null, e.executor.get(cmd.id)!!.undoneBy)
    }

    @Test
    fun `an undo goes ahead while the rule that lets them see the device is in place`() {
        val e = env()
        val cmd = turnOnAsGuest(e)
        e.db.write { identityQueries.insertDevicePolicy("p1", "h1", alice.ha.Connections.DEFAULT_ID, "light.one", "role", "guest", "allow", null, "u1", 1) }
        val undone = runBlocking { e.executor.undo(cmd.id) }
        assertNotNull(undone?.undoneBy)
    }

    @Test
    fun `an undo is refused once the requester has left the household`() {
        val e = env()
        val cmd = turnOnAsGuest(e)
        e.db.write { identityQueries.insertDevicePolicy("p1", "h1", alice.ha.Connections.DEFAULT_ID, "light.one", "role", "guest", "allow", null, "u1", 1) }
        e.db.write { identityQueries.deleteHouseholdMemberById("m2") }
        assertFailsWith<AppException> { runBlocking { e.executor.undo(cmd.id) } }
    }
}
