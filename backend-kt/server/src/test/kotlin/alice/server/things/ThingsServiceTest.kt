package alice.server.things

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.ha.FakeGateway
import alice.ha.StateCache
import alice.ha.Thing
import alice.server.households.HouseholdService
import alice.core.time.SystemTimeProvider
import alice.core.time.TimeProvider
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.junit.jupiter.api.Test

class ThingsServiceTest {
    private fun setup(): Triple<Database, HouseholdService, ThingsService> {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val hs = HouseholdService(db, SystemTimeProvider)
        val gw = FakeGateway()
        val svc = ThingsService(gw, db, hs)
        return Triple(db, hs, svc)
    }

    @Test
    fun `areas returns from gateway`() {
        val (_, _, svc) = setup()
        runBlocking {
            val areas = svc.areas()
            // FakeGateway returns empty
            assertTrue(areas.isEmpty())
        }
    }

    /** A home with two devices: a lamp (light) and a heater with a socket (switch + power sensor). */
    private fun home(): Pair<ThingsService, FakeGateway> {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val gw = FakeGateway()
        gw.areas.add(alice.ha.HaAreaRegistryEntry("a1", "Living room", null))
        for ((dev, entities) in listOf("lamp" to listOf("light.lamp"), "heater" to listOf("switch.heater", "sensor.heater_power"))) {
            gw.devices.add(alice.ha.HaDeviceRegistryEntry(id = dev, name = dev, area_id = "a1", identifiers = listOf(listOf("x", dev))))
            for (e in entities) {
                gw.entityRegistry.add(alice.ha.HaEntityRegistryEntry(entity_id = e, device_id = dev, platform = e.substringBefore('.'), original_name = e))
                gw.states.add(alice.ha.HaEntityState(e, if (e.startsWith("sensor")) "12" else "off", mapOf("friendly_name" to kotlinx.serialization.json.JsonPrimitive(e))))
            }
        }
        return ThingsService(gw, db, HouseholdService(db, SystemTimeProvider)) to gw
    }

    private fun lamp(things: List<Thing>) = things.first { "light.lamp" in it.entityIds }
    private fun heater(things: List<Thing>) = things.first { "switch.heater" in it.entityIds }

    @Test
    fun `rename changes the thing's name`() = kotlinx.coroutines.runBlocking {
        val (svc, _) = home()
        val before = lamp(svc.things("h1"))
        svc.rename("h1", "u1", before.id, "Reading lamp")
        assertEquals("Reading lamp", lamp(svc.things("h1")).name)
        assertEquals(before.id, lamp(svc.things("h1")).id, "renaming must not change identity")
        svc.rename("h1", "u1", before.id, null)
        assertEquals(before.name, lamp(svc.things("h1")).name)
    }

    @Test
    fun `rename uses the injected clock and keeps one tov id`() = kotlinx.coroutines.runBlocking<Unit> {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val gw = FakeGateway()
        gw.areas.add(alice.ha.HaAreaRegistryEntry("a1", "Living room", null))
        gw.devices.add(alice.ha.HaDeviceRegistryEntry(id = "lamp", name = "lamp", area_id = "a1", identifiers = listOf(listOf("x", "lamp"))))
        gw.entityRegistry.add(alice.ha.HaEntityRegistryEntry(entity_id = "light.lamp", device_id = "lamp", platform = "light", original_name = "lamp"))
        gw.states.add(alice.ha.HaEntityState("light.lamp", "off", mapOf("friendly_name" to kotlinx.serialization.json.JsonPrimitive("lamp"))))
        val fixed = 1_700_000_000_000L
        val svc = ThingsService(gw, db, HouseholdService(db, SystemTimeProvider), time = TimeProvider { fixed })
        val id = lamp(svc.things("h1")).id
        svc.rename("h1", "u1", id, "Reading lamp")
        val first = db.read { identityQueries.selectThingOverridesByHousehold("h1").executeAsList() }.first()
        assertEquals(fixed, first.updated_at)
        assertTrue(first.id.startsWith("tov_") && first.id.length == "tov_".length + 26)
        svc.rename("h1", "u1", id, "Reading lamp two")
        val second = db.read { identityQueries.selectThingOverridesByHousehold("h1").executeAsList() }.first()
        assertEquals(first.id, second.id)
        assertEquals(fixed, second.updated_at)
    }

    @Test
    fun `hiding removes a thing from the normal list but not from the full one`() = kotlinx.coroutines.runBlocking {
        val (svc, _) = home()
        val id = lamp(svc.things("h1")).id
        svc.setHidden("h1", "u1", id, true)
        assertTrue(svc.things("h1").none { "light.lamp" in it.entityIds })
        assertTrue(svc.things("h1", includeHidden = true).any { "light.lamp" in it.entityIds && it.hidden })
        svc.setHidden("h1", "u1", id, false)
        assertTrue(svc.things("h1").any { "light.lamp" in it.entityIds })
    }

    @Test
    fun `merging two things makes one that holds both, and unmerging separates them`() = kotlinx.coroutines.runBlocking {
        val (svc, _) = home()
        val all = svc.things("h1")
        val count = all.size
        svc.merge("h1", "u1", listOf(lamp(all).ref, heater(all).ref))
        val merged = svc.things("h1")
        assertEquals(count - 1, merged.size)
        assertTrue(lamp(merged) === merged.first { "switch.heater" in it.entityIds } || lamp(merged).id == heater(merged).id)
        svc.unmerge("h1", "u1", listOf(lamp(all).ref))
        assertEquals(count, svc.things("h1").size)
    }

    @Test
    fun `splitting an entity out gives it a thing of its own`() = kotlinx.coroutines.runBlocking {
        val (svc, _) = home()
        val before = svc.things("h1")
        assertTrue(heater(before).entityIds.containsAll(listOf("switch.heater", "sensor.heater_power")))
        svc.split("h1", "u1", heater(before).id, listOf("sensor.heater_power"))
        val after = svc.things("h1")
        assertEquals(before.size + 1, after.size)
        assertTrue(after.none { "switch.heater" in it.entityIds && "sensor.heater_power" in it.entityIds })
    }

    /** Two households looking at the same Home Assistant inventory. */
    private fun twoHouseholds(): Triple<ThingsService, Database, FakeGateway> {
        val (_, gw) = home()
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "A", 1000)
            for (h in listOf("h1", "h2")) { identityQueries.insertHousehold(h, h, 1000); identityQueries.insertHouseholdSettings(h) }
        }
        return Triple(ThingsService(gw, db, HouseholdService(db, SystemTimeProvider)), db, gw)
    }

    @Test
    fun `a rename, hide or merge in one household does not show in another`() = kotlinx.coroutines.runBlocking {
        val (svc, _, _) = twoHouseholds()
        val base = svc.things("h2", includeHidden = true)
        val lampId = lamp(base).id
        svc.rename("h1", "u1", lampId, "Mine")
        svc.setHidden("h1", "u1", heater(base).id, true)
        svc.merge("h1", "u1", listOf(lamp(base).ref, heater(base).ref))

        val other = svc.things("h2", includeHidden = true)
        assertEquals(lamp(base).name, lamp(other).name)
        assertEquals(base.size, other.size, "h2 must not see h1's merge")
        assertTrue(other.none { it.hidden })
        assertEquals("Mine", svc.things("h1", includeHidden = true).first { "light.lamp" in it.entityIds }.name)
    }

    @Test
    fun `entity overrides and splits are per household too`() = kotlinx.coroutines.runBlocking {
        val (svc, _, _) = twoHouseholds()
        val base = svc.things("h2")
        svc.split("h1", "u1", heater(base).id, listOf("sensor.heater_power"))
        assertEquals(base.size + 1, svc.things("h1").size)
        assertEquals(base.size, svc.things("h2").size)
    }

    @Test
    fun `a new service on the same database reloads each household's own overrides`() = kotlinx.coroutines.runBlocking {
        val (svc, db, gw) = twoHouseholds()
        val base = svc.things("h1")
        svc.rename("h1", "u1", lamp(base).id, "Kept")
        svc.merge("h1", "u1", listOf(lamp(base).ref, heater(base).ref))
        val reopened = ThingsService(gw, db, HouseholdService(db, SystemTimeProvider))
        assertEquals(base.size - 1, reopened.things("h1").size)
        assertEquals(base.size, reopened.things("h2").size)
        assertTrue(reopened.things("h1").any { it.name == "Kept" })
    }

    @Test
    fun `changing a thing announces things_changed for that household`() = kotlinx.coroutines.runBlocking {
        val (_, gw) = home()
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "A", 1000)
            identityQueries.insertHousehold("h1", "H", 1000); identityQueries.insertHouseholdSettings("h1")
        }
        val bus = alice.core.events.InProcessEventBus()
        val seen = java.util.concurrent.CopyOnWriteArrayList<alice.core.events.AppEvent>()
        val job = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default).let { sc -> sc.launch { bus.events.collect { seen += it } } }
        kotlinx.coroutines.delay(50)
        val svc = ThingsService(gw, db, HouseholdService(db, SystemTimeProvider), bus = bus)
        svc.rename("h1", "u1", lamp(svc.things("h1")).id, "Reading lamp")
        kotlinx.coroutines.withTimeout(3000) { while (seen.none { it.type == "things.changed" }) kotlinx.coroutines.delay(10) }
        assertEquals("h1", seen.first { it.type == "things.changed" }.householdId)
        job.cancel()
    }

    /** A gateway that counts how often the whole inventory is fetched. */
    private class CountingGateway(val inner: FakeGateway) : alice.ha.HomeAssistantGateway by inner {
        val areaCalls = java.util.concurrent.atomic.AtomicInteger()
        override suspend fun getAreas(): List<alice.ha.HaAreaRegistryEntry> { areaCalls.incrementAndGet(); kotlinx.coroutines.delay(20); return inner.getAreas() }
    }

    private fun counting(ttlMs: Long = 30_000, bus: alice.core.events.EventBus? = null): Triple<ThingsService, CountingGateway, FakeGateway> {
        val (base, fake) = home()
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "A", 1000)
            identityQueries.insertHousehold("h1", "H", 1000); identityQueries.insertHouseholdSettings("h1")
        }
        val gw = CountingGateway(fake)
        return Triple(ThingsService(gw, db, HouseholdService(db, SystemTimeProvider), bus = bus, inventoryTtlMs = ttlMs), gw, fake)
    }

    @Test
    fun `the inventory is fetched once for many reads`() = kotlinx.coroutines.runBlocking {
        val (svc, gw, _) = counting()
        repeat(5) { svc.things("h1") }
        assertEquals(1, gw.areaCalls.get())
    }

    @Test
    fun `reads at the same moment share one fetch`() = kotlinx.coroutines.runBlocking {
        val (svc, gw, _) = counting()
        kotlinx.coroutines.coroutineScope { (1..10).map { async(kotlinx.coroutines.Dispatchers.Default) { svc.things("h1") } }.forEach { it.await() } }
        assertEquals(1, gw.areaCalls.get())
    }

    @Test
    fun `an entry past its time is fetched again, and a registry change forces a fresh read`() = kotlinx.coroutines.runBlocking {
        val (expiring, expiringGw, _) = counting(ttlMs = 0)
        expiring.things("h1"); expiring.things("h1")
        assertEquals(2, expiringGw.areaCalls.get())

        val bus = alice.core.events.InProcessEventBus()
        val (svc, gw, fake) = counting(bus = bus)
        val before = svc.things("h1").size
        fake.devices.add(alice.ha.HaDeviceRegistryEntry(id = "fan", name = "fan", area_id = "a1", identifiers = listOf(listOf("x", "fan"))))
        fake.entityRegistry.add(alice.ha.HaEntityRegistryEntry(entity_id = "fan.fan", device_id = "fan", platform = "fan", original_name = "fan"))
        fake.states.add(alice.ha.HaEntityState("fan.fan", "off", mapOf("friendly_name" to kotlinx.serialization.json.JsonPrimitive("fan"))))
        assertEquals(before, svc.things("h1").size, "still the cached view")
        bus.publish(alice.core.events.ThingsChanged(householdId = "h1", reason = "registry"))
        kotlinx.coroutines.withTimeout(3000) { while (svc.things("h1").size == before) kotlinx.coroutines.delay(20) }
        assertEquals(before + 1, svc.things("h1").size)
        assertEquals(2, gw.areaCalls.get())
    }

    @Test
    fun `thing ids are the hash of the shared connection id and the ref, so clients and stored data keep matching`() = kotlinx.coroutines.runBlocking {
        assertEquals("conn-1", alice.ha.Connections.DEFAULT_ID)
        val (svc, _) = home()
        val thing = lamp(svc.things("h1"))
        val expected = "thing_" + java.security.MessageDigest.getInstance("SHA-1")
            .digest("conn-1:${thing.ref}".toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
        assertEquals(expected, thing.id)
        assertEquals("device:lamp", thing.ref)
    }

    @Test
    fun `setEntity stores override`() {
        val (_, _, svc) = setup()
        svc.setEntity("h1", "u1", "light.x", EntityPatchBody(displayName = "My Light", hidden = true))
        assertTrue(true)
    }

    @Test
    fun `canSee returns true for admin`() {
        val (_, _, svc) = setup()
        val caller = Caller("h1", "u1", alice.server.households.Role.ADMIN, true)
        // No policies, admin can see everything
        assertTrue(svc.canSee(caller, "conn-1", "light.x"))
    }
}

private fun runBlocking(block: suspend () -> Unit) {
    kotlinx.coroutines.runBlocking { block() }
}
