package alice.server

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaAreaRegistryEntry
import alice.ha.HaDeviceRegistryEntry
import alice.ha.HaEntityRegistryEntry
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.server.actions.ActionService
import alice.server.actions.ActionSpec
import alice.server.commands.CommandExecutor
import alice.server.commands.InMemoryCommandStore
import alice.server.favorites.FavoritesService
import alice.server.groups.GroupsService
import alice.server.households.HouseholdService
import alice.server.permissions.PermissionService
import alice.server.scenes.ScenesService
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class GroupsScenesTest {
    private fun setup(): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        val time = SystemTimeProvider
        val hs = HouseholdService(db, time)
        db.write {
            identityQueries.insertUser("u1", "Admin", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val gw = FakeGateway()
        gw.states.add(HaEntityState("light.living", "on", mapOf("friendly_name" to JsonPrimitive("Living light"), "brightness" to JsonPrimitive(200)), "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
        gw.states.add(HaEntityState("switch.kettle", "off", mapOf("friendly_name" to JsonPrimitive("Kettle")), "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.living", device_id = "dev1", area_id = "area1", platform = "light", name = null, original_name = "Living light"))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "switch.kettle", device_id = "dev2", area_id = "area1", platform = "switch", name = null, original_name = "Kettle"))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "Living light", name_by_user = null, area_id = "area1", manufacturer = "Acme", model = "Bulb"))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev2", name = "Kettle", name_by_user = null, area_id = "area1", manufacturer = "Acme", model = "Plug"))
        gw.areas.add(HaAreaRegistryEntry("area1", "Living room", null))

        val favorites = FavoritesService(db)
        val things = ThingsService(gw, db, hs, favorites)
        val perms = PermissionService(db, hs, time, Json)
        val store = InMemoryCommandStore()
        val executor = CommandExecutor(store, gw, StateCache(), hs, time, null, null)
        val actions = ActionService(things, perms, executor)
        val groups = GroupsService(db, things, actions, time)
        val scenes = ScenesService(db, actions, time)
        val caller = Caller("h1", "u1", alice.server.households.Role.ADMIN, true)
        return Env(gw, things, actions, groups, scenes, favorites, caller, db)
    }

    data class Env(val gw: FakeGateway, val things: ThingsService, val actions: ActionService, val groups: GroupsService, val scenes: ScenesService, val favorites: FavoritesService, val caller: Caller, val db: alice.core.db.Database)

    @Test fun `group and scene basic flows`() = runBlocking {
        val e = setup()
        val all = e.things.things("h1")
        assertTrue(all.isNotEmpty())
        val ids = all.take(2).map { it.id }
        val g = e.groups.create(e.caller, "Lights", null, ids)
        assertEquals("Lights", g.name)
        assertTrue(e.groups.list(e.caller).any { it.id == g.id })
        val got = e.groups.get(e.caller, g.id)
        assertEquals(g.id, got.id)

        val lightEntity = all.firstNotNullOf { t -> (listOfNotNull(t.primary) + t.others + t.controls).firstOrNull { it.entityId.startsWith("light.") }?.entityId }
        val s = e.scenes.create(e.caller, "Movie", null, null, listOf(ActionSpec(lightEntity, "turn_on", emptyMap())))
        assertEquals("Movie", s.name)
        assertTrue(e.scenes.list(e.caller).any { it.id == s.id })
        val (cmds, skipped) = e.scenes.activate(e.caller, s.id)
        assertTrue(skipped.isEmpty())
        assertEquals(1, cmds.size)
    }

    private fun storedRefs(e: Env, groupId: String) =
        e.db.read { identityQueries.selectGroupMembers(groupId).executeAsList() }.map { it.ref }

    @Test fun `reading a group never changes it, even when a member's stored ref has drifted`() = runBlocking {
        val e = setup()
        val thing = e.things.things("h1").first()
        val g = e.groups.create(e.caller, "Lights", null, listOf(thing.id))
        val stale = "entity:" + thing.entityIds.first()
        e.db.write {
            identityQueries.deleteGroupMembers(g.id)
            identityQueries.insertGroupMember(g.id, alice.ha.Connections.DEFAULT_ID, stale, 0)
        }
        assertEquals(listOf(stale), storedRefs(e, g.id))
        val seen = e.groups.get(e.caller, g.id)
        assertEquals(listOf(thing.id), seen.devices.map { it.id }, "the stale ref still resolves to the device")
        e.groups.list(e.caller)
        assertEquals(listOf(stale), storedRefs(e, g.id), "reads must leave the stored ref as it was")
    }

    @Test fun `relinking repairs drifted refs in one step and is a no-op the second time`() = runBlocking {
        val e = setup()
        val things = e.things.things("h1")
        val g = e.groups.create(e.caller, "Lights", null, things.map { it.id })
        val first = things.first()
        e.db.write {
            val members = identityQueries.selectGroupMembers(g.id).executeAsList()
            identityQueries.deleteGroupMembers(g.id)
            members.forEach { m ->
                identityQueries.insertGroupMember(g.id, m.connection_id, if (m.ref == first.ref) "entity:" + first.entityIds.first() else m.ref, m.position)
            }
        }
        val before = storedRefs(e, g.id)
        assertTrue(before.contains("entity:" + first.entityIds.first()))
        assertEquals(1, e.groups.relinkStaleMembers("h1"))
        val after = storedRefs(e, g.id)
        assertEquals(before.size, after.size, "no member lost")
        assertTrue(after.contains(first.ref))
        assertEquals(0, e.groups.relinkStaleMembers("h1"))
        assertEquals(after, storedRefs(e, g.id))
    }
}
