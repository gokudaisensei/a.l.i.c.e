package alice.server.commands

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaEntityState
import alice.ha.HaServiceCallInput
import alice.ha.StateCache
import alice.server.households.HouseholdService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** What the executor actually sends to Home Assistant, and what it needs before it sends it. */
class CommandDispatchTest {
    private class Env(val gateway: FakeGateway, val cache: StateCache, val executor: CommandExecutor)

    private fun env(): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val cache = StateCache()
        val gateway = FakeGateway()
        val executor = CommandExecutor(InMemoryCommandStore(), gateway, cache, HouseholdService(db, SystemTimeProvider), SystemTimeProvider)
        return Env(gateway, cache, executor)
    }

    private fun run(e: Env, entityId: String, action: String, params: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(), steppedUp: Boolean = false): DeviceCommand =
        runBlocking {
            e.executor.execute(
                CommandInput("h1", entityId, action, params, Actor("u1", CommandSource.USER, steppedUp), confirmTimeoutMs = 150),
            )
        }

    private fun lastCall(e: Env): HaServiceCallInput = e.gateway.calls.last()

    @Test
    fun `the call names the entity it is for`() {
        val e = env()
        run(e, "light.x", "turn_on")
        val call = lastCall(e)
        assertEquals("light", call.domain)
        assertEquals("turn_on", call.service)
        assertEquals(listOf("light.x"), call.target?.entity_id)
    }

    @Test
    fun `numbers stay numbers`() {
        val e = env()
        run(e, "light.x", "set_brightness", mapOf("brightness_pct" to JsonPrimitive(50)))
        val v = lastCall(e).data!!.getValue("brightness_pct") as JsonPrimitive
        assertFalse(v.isString)
        assertEquals("50", v.content)
    }

    @Test
    fun `strings are not wrapped in quotes`() {
        val e = env()
        run(e, "climate.x", "set_hvac_mode", mapOf("hvac_mode" to JsonPrimitive("cool")))
        val v = lastCall(e).data!!.getValue("hvac_mode") as JsonPrimitive
        assertTrue(v.isString)
        assertEquals("cool", v.content)
    }

    @Test
    fun `an rgb array stays an array`() {
        val e = env()
        run(e, "light.x", "set_color", mapOf("rgb" to JsonArray(listOf(JsonPrimitive(255), JsonPrimitive(0), JsonPrimitive(10)))))
        val v = lastCall(e).data!!.getValue("rgb_color")
        assertTrue(v is JsonArray)
        assertEquals(3, v.size)
    }

    @Test
    fun `toggle calls the toggle service`() {
        val e = env()
        run(e, "light.x", "toggle")
        assertEquals("toggle", lastCall(e).service)
    }

    @Test
    fun `locking needs no passkey, unlocking does, opening a cover does not`() {
        val e = env()
        val lock = run(e, "lock.front", "lock")
        assertTrue(lock.failure?.first != FailureCode.STEP_UP_REQUIRED)
        assertEquals("lock", lastCall(e).service)

        val calls = e.gateway.calls.size
        val unlock = run(e, "lock.front", "unlock")
        assertEquals(FailureCode.STEP_UP_REQUIRED, unlock.failure?.first)
        assertEquals(calls, e.gateway.calls.size, "an unlock without a passkey must not reach Home Assistant")
        run(e, "lock.front", "unlock", steppedUp = true)
        assertEquals("unlock", lastCall(e).service)

        val cover = run(e, "cover.garage", "open")
        assertTrue(cover.failure?.first != FailureCode.STEP_UP_REQUIRED)
    }

    @Test
    fun `a colour command is confirmed from the light's new colour`() {
        val e = env()
        e.gateway.onCallService = {
            e.cache.apply(
                HaEntityState(
                    "light.x", "on",
                    mapOf("rgb_color" to JsonArray(listOf(JsonPrimitive(255), JsonPrimitive(0), JsonPrimitive(0)))),
                ),
                "light.x",
            )
        }
        val cmd = run(e, "light.x", "set_color", mapOf("rgb" to JsonArray(listOf(JsonPrimitive(255), JsonPrimitive(0), JsonPrimitive(0)))))
        assertEquals(CommandState.CONFIRMED, cmd.state)
        assertEquals("state", cmd.confirmedBy)
    }

    @Test
    fun `a text parameter is confirmed from the new state`() {
        val e = env()
        e.gateway.onCallService = { e.cache.apply(HaEntityState("climate.x", "cool"), "climate.x") }
        val cmd = run(e, "climate.x", "set_hvac_mode", mapOf("hvac_mode" to JsonPrimitive("cool")))
        assertEquals(CommandState.CONFIRMED, cmd.state)
        assertNotNull(cmd.actualState)
    }
}
