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
import alice.server.automations.AutomationsService
import alice.server.commands.CommandExecutor
import alice.server.commands.InMemoryCommandStore
import alice.server.favorites.FavoritesService
import alice.server.groups.GroupsService
import alice.server.households.HouseholdService
import alice.server.modes.ModesService
import alice.server.permissions.PermissionService
import alice.server.presence.PresenceService
import alice.server.routines.Caller as RoutineCaller
import alice.server.routines.RoutinesService
import alice.server.scenes.ScenesService
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class RoutinesAutomationsPresenceTest {
    private fun env(): Env {
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
        gw.states.add(HaEntityState("person.gokul", "home", mapOf("friendly_name" to JsonPrimitive("Gokul")), "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "light.living", device_id = "dev1", area_id = "area1", platform = "light", name = null, original_name = "Living light"))
        gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = "person.gokul", device_id = null, area_id = null, platform = "person", name = null, original_name = "Gokul"))
        gw.devices.add(HaDeviceRegistryEntry(id = "dev1", name = "Living light", name_by_user = null, area_id = "area1", manufacturer = "Acme", model = "Bulb"))
        gw.areas.add(HaAreaRegistryEntry("area1", "Living room", null))

        val favorites = FavoritesService(db)
        val things = ThingsService(gw, db, hs, favorites)
        val presence = PresenceService(db, hs, time, things)
        val perms = PermissionService(db, hs, time, Json)
        val store = InMemoryCommandStore()
        val executor = CommandExecutor(store, gw, StateCache(), hs, time, null, null)
        val actions = ActionService(things, perms, executor)
        val scenes = ScenesService(db, actions, time)
        val modes = ModesService(db, time)
        val routines = RoutinesService(db, actions, scenes, modes, hs, time)
        val automations = AutomationsService(db, time, actions)
        val caller = Caller("h1", "u1", alice.server.households.Role.ADMIN, true)
        val rc = RoutineCaller("h1", "u1", alice.server.households.Role.ADMIN, true)
        val ac = alice.server.automations.Caller("h1", "u1", alice.server.households.Role.ADMIN, true)
        return Env(db, gw, things, presence, actions, scenes, modes, routines, automations, caller, rc, ac)
    }

    data class Env(
        val db: Database, val gw: FakeGateway, val things: ThingsService, val presence: PresenceService,
        val actions: ActionService, val scenes: ScenesService, val modes: ModesService,
        val routines: RoutinesService, val automations: AutomationsService,
        val caller: Caller, val rc: RoutineCaller, val ac: alice.server.automations.Caller,
    )

    private suspend fun waitForTerminal(routines: RoutinesService, c: RoutineCaller, runId: String, timeoutMs: Long = 5000): alice.server.routines.RoutineRunView {
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < timeoutMs) {
            val r = routines.getRun(c, runId)
            if (r.state != "running") return r
            delay(50)
        }
        return routines.getRun(c, runId)
    }

    @Test fun `routine CRUD execute and run persistence`() = runBlocking {
        val e = env()
        val steps = buildJsonArray {
            add(buildJsonObject { put("type", "mode"); put("mode", "night") })
            add(buildJsonObject { put("type", "delay"); put("seconds", 1) })
            add(buildJsonObject { put("type", "mode"); put("mode", "home") })
        }
        val r = e.routines.create(e.rc, "Bedtime", null, steps, "stop")
        assertEquals("Bedtime", r.name)
        assertEquals(3, r.steps.size)
        assertTrue(e.routines.list("h1").any { it.id == r.id })
        assertEquals(r.id, e.routines.get("h1", r.id).id)

        val run = e.routines.execute(e.rc, r.id)
        assertEquals("running", run.state)
        assertEquals(r.id, run.routineId)
        assertEquals(3, run.steps.size)

        val done = waitForTerminal(e.routines, e.rc, run.id, 4000)
        assertEquals("completed", done.state)
        assertTrue(done.steps.all { it.state == "ok" })
        assertEquals("home", e.modes.get("h1").mode)

        val listed = e.routines.listRuns(e.rc)
        assertTrue(listed.any { it.id == run.id })
        assertEquals(done.id, e.routines.getRun(e.rc, run.id).id)
    }

    @Test fun `routine cancel running delay`() = runBlocking {
        val e = env()
        val steps = buildJsonArray {
            add(buildJsonObject { put("type", "delay"); put("seconds", 5) })
            add(buildJsonObject { put("type", "mode"); put("mode", "away") })
        }
        val r = e.routines.create(e.rc, "Long", null, steps, "stop")
        val run = e.routines.execute(e.rc, r.id)
        delay(100)
        val cancelled = e.routines.cancel(e.rc, run.id)
        assertNotNull(cancelled)
        val done = waitForTerminal(e.routines, e.rc, run.id, 3000)
        assertTrue(done.state == "cancelled" || done.state == "stopped", "state was ${done.state}")
    }

    @Test fun `many routines started at once all run to completion`() = runBlocking {
        val e = env()
        val steps = buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "night") }) }
        val r = e.routines.create(e.rc, "Quick", null, steps, "stop")
        // Each run registers itself before it starts; a start that raced its own registration would be dropped and stay "running".
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        val start = java.util.concurrent.CountDownLatch(1)
        val futures = (1..20).map { pool.submit<alice.server.routines.RoutineRunView> { start.await(); e.routines.execute(e.rc, r.id) } }
        start.countDown()
        val runs = futures.map { it.get() }
        pool.shutdown()
        assertEquals(20, runs.map { it.id }.toSet().size)
        for (run in runs) {
            val done = waitForTerminal(e.routines, e.rc, run.id, 5000)
            assertEquals("completed", done.state, "run ${run.id}")
            assertTrue(done.steps.all { it.state == "ok" })
        }
    }

    @Test fun `a run left running by a restart is picked up and finished`() = runBlocking {
        val e = env()
        val steps = buildJsonArray {
            add(buildJsonObject { put("type", "mode"); put("mode", "away") })
        }
        val r = e.routines.create(e.rc, "Resume me", null, steps, "stop")
        val pending = listOf(alice.server.routines.StepResult(0, "mode", "pending", null, null, steps[0]))
        e.db.write {
            identityQueries.insertRoutineRun("run_stuck", r.id, r.name, "h1", "u1", "running", System.currentTimeMillis(), null, Json.encodeToString(pending), "stop", 0, null, 0L, 0)
        }
        assertEquals(1, e.routines.resumeInterrupted())
        val done = waitForTerminal(e.routines, e.rc, "run_stuck", 4000)
        assertEquals("completed", done.state)
        assertEquals("away", e.modes.get("h1").mode)
    }

    @Test fun `a run whose owner lost access is failed, not resumed`() = runBlocking {
        val e = env()
        val steps = buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "away") }) }
        val r = e.routines.create(e.rc, "Orphan", null, steps, "stop")
        val pending = listOf(alice.server.routines.StepResult(0, "mode", "pending", null, null, steps[0]))
        e.db.write {
            identityQueries.insertUser("gone", "Gone", 1000)
            identityQueries.insertRoutineRun("run_orphan", r.id, r.name, "h1", "gone", "running", System.currentTimeMillis(), null, Json.encodeToString(pending), "stop", 0, null, 0L, 0)
        }
        e.routines.resumeInterrupted()
        val after = e.routines.getRun(e.rc, "run_orphan")
        assertEquals("failed", after.state)
        assertNotEquals("away", e.modes.get("h1").mode)
    }

    @Test fun `routine delete and not found`() = runBlocking<Unit> {
        val e = env()
        val steps = buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "night") }) }
        val r = e.routines.create(e.rc, "Temp", null, steps, "stop")
        e.routines.remove(e.rc, r.id)
        assertThrows(Exception::class.java) { e.routines.get("h1", r.id) }
    }

    @Test fun `presence people and link basics`() = runBlocking<Unit> {
        val e = env()
        val p = e.presence.peopleAsync("h1")
        assertEquals(1, p.people.size)
        assertEquals("u1", p.people[0].userId)
        assertEquals("admin", p.people[0].role)
        // link to discovered HA person
        val linked = runCatching { e.presence.link("h1", "u1", "u1", "person.gokul") }
        assertTrue(linked.isSuccess)
        val after = e.presence.peopleAsync("h1")
        assertEquals("person.gokul", after.people[0].personEntityId)

        // unlink
        e.presence.link("h1", "u1", "u1", null)
        val unlinked = e.presence.peopleAsync("h1")
        assertNull(unlinked.people[0].personEntityId)

        // unknown member
        assertThrows(Exception::class.java) { runBlocking { e.presence.link("h1", "u1", "nope", null) } }
    }

    @Test fun `automation CRUD preview and runs`() = runBlocking<Unit> {
        val e = env()
        val def = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "time"); put("at", "22:30") })
            put("conditions", buildJsonArray { })
            put("actions", buildJsonArray {
                add(buildJsonObject { put("type", "mode"); put("mode", "night") })
            })
        }
        val preview = e.automations.preview(e.ac, "Night", def)
        assertTrue(preview.summary.contains("22:30") || preview.summary.contains("When"))

        val created = e.automations.create(e.ac, "Night mode", true, def)
        assertEquals("Night mode", created.name)
        assertTrue(created.enabled)
        assertNotNull(created.summary)
        assertTrue(e.automations.list(e.ac).any { it.id == created.id })

        val got = e.automations.get(e.ac, created.id)
        assertEquals(created.id, got.id)

        val disabled = e.automations.setEnabled(e.ac, created.id, false)
        assertFalse(disabled.enabled)
        val enabled = e.automations.setEnabled(e.ac, created.id, true)
        assertTrue(enabled.enabled)

        // record run and list
        e.automations.recordRun("h1", created.id, "time")
        val runs = e.automations.runs(e.ac, created.id)
        assertTrue(runs.isNotEmpty())
        assertEquals("time", runs.first().source)

        e.automations.remove(e.ac, created.id)
        assertThrows(Exception::class.java) { runBlocking { e.automations.get(e.ac, created.id) } }
    }
}
