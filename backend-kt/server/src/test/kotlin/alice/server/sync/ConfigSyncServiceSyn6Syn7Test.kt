package alice.server.sync

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.ConfigJobService
import alice.ha.FakeGateway
import alice.ha.StateCache
import alice.server.actions.ActionService
import alice.server.automations.AutomationsService
import alice.server.commands.CommandExecutor
import alice.server.commands.InMemoryCommandStore
import alice.server.households.HouseholdService
import alice.server.modes.ModesService
import alice.server.permissions.PermissionService
import alice.server.routines.RoutinesService
import alice.server.scenes.ScenesService
import alice.server.sync.ConfigSyncService
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConfigSyncServiceSyn6Syn7Test {
    private fun newDb(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seedHousehold(db: Database, hid: String) {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u_$hid", "User", t)
            identityQueries.insertUserPreferences("u_$hid")
            identityQueries.insertHousehold(hid, "Home", t)
            identityQueries.insertHouseholdSettings(hid)
        }
    }

    private class Stack(val db: Database, val sync: ConfigSyncService, val seen: MutableSet<String>)

    private fun newStack(db: Database, throwFor: String? = null): Stack {
        val time = SystemTimeProvider
        val households = HouseholdService(db, time)
        val gw = FakeGateway()
        val things = ThingsService(gw, db, households)
        val perms = PermissionService(db, households, time, Json)
        val store = InMemoryCommandStore()
        val executor = CommandExecutor(store, gw, StateCache(), households, time)
        val actions = ActionService(things, perms, executor)
        val scenes = ScenesService(db, actions, time)
        val modes = ModesService(db, time)
        val routines = RoutinesService(db, actions, scenes, modes, households, time)
        val automations = AutomationsService(db, time, actions)
        val jobs = ConfigJobService(db)
        val seen = mutableSetOf<String>()
        val sync = object : ConfigSyncService(db, jobs, scenes, routines, automations) {
            override fun verify(householdId: String): Boolean {
                seen += householdId
                if (householdId == throwFor) throw IllegalStateException("boom")
                return true
            }
        }
        return Stack(db, sync, seen)
    }

    @Test
    fun `reconcileScenes is suspend and returns the reconciled count`() = runBlocking<Unit> {
        val db = newDb()
        seedHousehold(db, "h1")
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertScene("scn_1", "h1", "Scene", null, null, """[]""", "u_h1", t, t)
            identityQueries.updateScene("Scene", null, null, """[]""", t, null, "failed", "boom", null, null, "scn_1")
        }
        val stack = newStack(db)
        val caller = alice.server.things.Caller("h1", "u_h1", alice.server.households.Role.ADMIN, true)
        val queued = stack.sync.reconcileScenes(caller)
        assertEquals(1, queued)
    }

    @Test
    fun `verifyAll continues after a household throws`() = runBlocking<Unit> {
        val db = newDb()
        seedHousehold(db, "hh1")
        seedHousehold(db, "hh2")
        val stack = newStack(db, throwFor = "hh1")
        stack.sync.verifyAll()
        assertEquals(setOf("hh1", "hh2"), stack.seen)
    }
}
