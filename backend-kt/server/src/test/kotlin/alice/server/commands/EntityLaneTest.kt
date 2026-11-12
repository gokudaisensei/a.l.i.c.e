package alice.server.commands

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.server.households.HouseholdService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EntityLaneTest {
    private class Env(val executor: CommandExecutor, val gateway: FakeGateway) {
        val running = AtomicInteger(); val peak = AtomicInteger(); val peakPerEntity = java.util.concurrent.ConcurrentHashMap<String, AtomicInteger>()
        val active = java.util.concurrent.ConcurrentHashMap<String, AtomicInteger>()
    }

    private fun env(holdMs: Long = 150): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "A", 1); identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "H", 1); identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
        }
        val gw = FakeGateway()
        val cache = StateCache()
        for (id in listOf("light.a", "light.b")) {
            val st = HaEntityState(id, "off", mapOf("brightness" to JsonPrimitive(10)))
            gw.states.add(st); cache.apply(st, id)
        }
        val executor = CommandExecutor(InMemoryCommandStore(), gw, cache, HouseholdService(db, SystemTimeProvider), SystemTimeProvider)
        val e = Env(executor, gw)
        gw.onCallService = { call ->
            val entity = call.target!!.entity_id!!.first()
            val now = e.active.getOrPut(entity) { AtomicInteger() }.incrementAndGet()
            e.peakPerEntity.getOrPut(entity) { AtomicInteger() }.accumulateAndGet(now, ::maxOf)
            e.peak.accumulateAndGet(e.running.incrementAndGet(), ::maxOf)
            delay(holdMs)
            e.running.decrementAndGet(); e.active.getValue(entity).decrementAndGet()
        }
        return e
    }

    private fun input(entity: String, action: String, params: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap()) =
        CommandInput("h1", entity, action, params, Actor("u1", CommandSource.USER, false), confirmTimeoutMs = 30)

    @Test
    fun `two toggles on one entity never run at the same time, and both run`() = runBlocking {
        val e = env()
        coroutineScope { listOf(async(Dispatchers.Default) { e.executor.execute(input("light.a", "toggle")) }, async(Dispatchers.Default) { e.executor.execute(input("light.a", "toggle")) }).forEach { it.await() } }
        assertEquals(1, e.peakPerEntity.getValue("light.a").get(), "commands for one entity must queue")
        assertEquals(2, e.gateway.calls.size, "a toggle is never merged with another")
    }

    @Test
    fun `different entities run in parallel`() = runBlocking {
        val e = env()
        coroutineScope { listOf(async(Dispatchers.Default) { e.executor.execute(input("light.a", "turn_on")) }, async(Dispatchers.Default) { e.executor.execute(input("light.b", "turn_on")) }).forEach { it.await() } }
        assertEquals(2, e.peak.get(), "two entities should be in flight together")
    }

    @Test
    fun `a set command waiting behind another is dropped when a newer one arrives`() = runBlocking {
        val e = env(holdMs = 300)
        fun brightness(pct: Int) = input("light.a", "set_brightness", mapOf("brightness_pct" to JsonPrimitive(pct)))
        val results = coroutineScope {
            val first = async(Dispatchers.Default) { e.executor.execute(brightness(20)) }
            delay(80)
            val second = async(Dispatchers.Default) { e.executor.execute(brightness(40)) }
            delay(40)
            val third = async(Dispatchers.Default) { e.executor.execute(brightness(80)) }
            listOf(first.await(), second.await(), third.await())
        }
        assertEquals(CommandState.CANCELLED, results[1].state, "the middle value is stale before it ever runs")
        assertTrue(results[0].state != CommandState.CANCELLED && results[2].state != CommandState.CANCELLED)
        assertEquals(listOf(20L, 80L), e.gateway.calls.map { (it.data!!["brightness_pct"] as JsonPrimitive).content.toLong() })
    }

    @Test
    fun `lanes are released when nothing is waiting`() = runBlocking {
        val e = env(holdMs = 10)
        repeat(5) { e.executor.execute(input("light.a", "turn_on")); e.executor.execute(input("light.b", "turn_off")) }
        assertEquals(0, e.executor.laneCount())
    }
}
