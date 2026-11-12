package alice.server.automations

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.StateCache
import alice.server.actions.ActionService
import alice.server.commands.CommandExecutor
import alice.server.commands.InMemoryCommandStore
import alice.server.households.HouseholdService
import alice.server.modes.ModesService
import alice.server.permissions.PermissionService
import alice.server.routines.RoutinesService
import alice.server.scenes.ScenesService
import alice.server.sync.HaCompile
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AutomationValidationAndRunTest {
    private class Env(
        val db: Database,
        val automations: AutomationsService,
        val modes: ModesService,
        val caller: Caller,
    )

    private fun env(skipSceneService: Boolean = false): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        val time = SystemTimeProvider
        val hs = HouseholdService(db, time)
        db.write {
            identityQueries.insertUser("u1", "One", 1)
            identityQueries.insertUser("u2", "Two", 1)
            identityQueries.insertUser("u3", "Three", 1)
            for (h in listOf("h1", "h2")) {
                identityQueries.insertHousehold(h, "Home $h", 1)
                identityQueries.insertHouseholdSettings(h)
            }
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
            identityQueries.insertHouseholdMember("m2", "h2", "u2", "admin", null, 1)
            identityQueries.insertHouseholdMember("m3", "h2", "u3", "member", null, 1)
            identityQueries.insertScene("scn-h1", "h1", "Scene one", null, null, "[]", "u1", 1, 1)
            identityQueries.insertScene("scn-h2", "h2", "Scene two", null, null, "[]", "u2", 1, 1)
            identityQueries.insertRoutine("rtn-h1", "h1", "Routine one", null, "[]", "stop", "u1", 1, 1, null, "pending", null, null, null)
            identityQueries.insertRoutine("rtn-h2", "h2", "Routine two", null, "[]", "stop", "u2", 1, 1, null, "pending", null, null, null)
        }
        val gw = FakeGateway()
        val things = ThingsService(gw, db, hs)
        val perms = PermissionService(db, hs, time, Json)
        val actions = ActionService(things, perms, CommandExecutor(InMemoryCommandStore(), gw, StateCache(), hs, time))
        val scenes = ScenesService(db, actions, time)
        val modes = ModesService(db, time)
        val routines = RoutinesService(db, actions, scenes, modes, hs, time)
        val automations = AutomationsService(
            db, time, actions,
            scenesRef = if (skipSceneService) lazyOf(null) else lazyOf(scenes),
            routinesRef = lazyOf(routines),
            modesRef = lazyOf(modes),
        )
        return Env(db, automations, modes, Caller("h1", "u1", alice.server.households.Role.ADMIN, true))
    }

    private fun def(trigger: JsonObject = buildJsonObject { put("type", "time"); put("at", "22:30") }, actions: kotlinx.serialization.json.JsonArray): JsonObject =
        buildJsonObject {
            put("version", 1)
            put("trigger", trigger)
            put("actions", actions)
        }

    @Test
    fun `arrive userId must be a string at most 100 chars and a member of this home`() = runBlocking<Unit> {
        val e = env()
        fun arrive(user: kotlinx.serialization.json.JsonElement) = def(
            buildJsonObject { put("type", "arrive"); put("userId", user) },
            buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "home") }) },
        )
        e.automations.create(e.caller, "member", true, arrive(JsonPrimitive("u1")))
        for (bad in listOf(JsonPrimitive(5), buildJsonObject { }, JsonPrimitive(""), JsonPrimitive("x".repeat(101)), JsonPrimitive("u2"), JsonPrimitive("nobody"))) {
            assertFailsWith<alice.core.error.AppException> { e.automations.create(e.caller, "bad", true, arrive(bad)) }
        }
    }

    @Test
    fun `scene and routine actions must belong to this household`() = runBlocking<Unit> {
        val e = env()
        e.automations.create(e.caller, "scene ok", true, def(actions = buildJsonArray { add(buildJsonObject { put("type", "scene"); put("sceneId", "scn-h1") }) }))
        e.automations.create(e.caller, "routine ok", true, def(actions = buildJsonArray { add(buildJsonObject { put("type", "routine"); put("routineId", "rtn-h1") }) }))
        for (bad in listOf(
            buildJsonObject { put("type", "scene"); put("sceneId", "scn-h2") },
            buildJsonObject { put("type", "scene"); put("sceneId", "missing") },
            buildJsonObject { put("type", "routine"); put("routineId", "rtn-h2") },
            buildJsonObject { put("type", "routine"); put("routineId", "missing") },
        )) {
            assertFailsWith<alice.core.error.AppException> {
                e.automations.create(e.caller, "bad", true, def(actions = buildJsonArray { add(bad) }))
            }
        }
        assertFailsWith<IllegalArgumentException> {
            HaCompile.compileAutomation("missing scene", def(actions = buildJsonArray { add(buildJsonObject { put("type", "scene") }) }))
        }
        assertFailsWith<IllegalArgumentException> {
            HaCompile.compileRoutine("missing scene", null, buildJsonArray { add(buildJsonObject { put("type", "scene") }) }, "stop")
        }
    }

    @Test
    fun `runNow continues after a failure and reports it`() = runBlocking<Unit> {
        val e = env()
        val actions = buildJsonArray {
            add(buildJsonObject { put("type", "mode"); put("mode", "night") })
            add(buildJsonObject { put("type", "mode"); put("mode", "not-a-mode") })
            add(buildJsonObject { put("type", "mode"); put("mode", "home") })
        }
        val id = "atm-run"
        e.db.write { identityQueries.insertAutomation(id, "h1", "Run", def(actions = actions).toString(), 1, "not_synced", null, null, null, null, null, "u1", 1, 1) }
        val result = e.automations.runNow(e.caller, id)
        assertEquals(false, result["ok"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(2, result["executed"]!!.jsonPrimitive.content.toInt())
        assertEquals(0, result["skipped"]!!.jsonPrimitive.content.toInt())
        val failed = result["failed"]!!.jsonArray
        assertEquals(1, failed.size)
        assertEquals(1, failed[0].jsonObject["index"]!!.jsonPrimitive.content.toInt())
        assertEquals("mode", failed[0].jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals("home", e.modes.get("h1").mode)
    }

    @Test
    fun `a missing optional service is skipped and not executed`() = runBlocking<Unit> {
        val e = env(skipSceneService = true)
        val actions = buildJsonArray { add(buildJsonObject { put("type", "scene"); put("sceneId", "scn-h1") }) }
        val id = "atm-skip"
        e.db.write { identityQueries.insertAutomation(id, "h1", "Skip", def(actions = actions).toString(), 1, "not_synced", null, null, null, null, null, "u1", 1, 1) }
        val result = e.automations.runNow(e.caller, id)
        assertEquals(true, result["ok"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(0, result["executed"]!!.jsonPrimitive.content.toInt())
        assertEquals(1, result["skipped"]!!.jsonPrimitive.content.toInt())
        assertTrue(result["failed"]!!.jsonArray.isEmpty())
    }

    @Test
    fun `all successful actions report ok with no failures`() = runBlocking<Unit> {
        val e = env()
        val actions = buildJsonArray {
            add(buildJsonObject { put("type", "mode"); put("mode", "night") })
            add(buildJsonObject { put("type", "mode"); put("mode", "home") })
        }
        val id = "atm-ok"
        e.db.write { identityQueries.insertAutomation(id, "h1", "Ok", def(actions = actions).toString(), 1, "not_synced", null, null, null, null, null, "u1", 1, 1) }
        val result = e.automations.runNow(e.caller, id)
        assertEquals(true, result["ok"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(2, result["executed"]!!.jsonPrimitive.content.toInt())
        assertEquals(0, result["failed"]!!.jsonArray.size)
    }
}
