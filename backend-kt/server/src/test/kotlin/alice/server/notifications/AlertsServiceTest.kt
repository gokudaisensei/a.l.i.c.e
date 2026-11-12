package alice.server.notifications

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.events.InProcessEventBus
import alice.core.time.TimeProvider
import alice.ha.FakeGateway
import alice.ha.HaAreaRegistryEntry
import alice.ha.HaDeviceRegistryEntry
import alice.ha.HaEntityRegistryEntry
import alice.ha.HaEntityState
import alice.server.households.HouseholdService
import alice.server.households.Role
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AlertsServiceTest {
    private val now = java.time.Instant.parse("2026-05-01T12:00:00Z").toEpochMilli()
    private val clock = TimeProvider { now }
    private fun iso(minutesAgo: Long) = java.time.Instant.ofEpochMilli(now - minutesAgo * 60_000).toString()

    private class Env(val svc: AlertsService, val things: ThingsService, val db: Database, val gw: FakeGateway, val caller: Caller)

    private fun env(): Env {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "A", 1); identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "H", 1); identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
        }
        val gw = FakeGateway()
        gw.areas.add(HaAreaRegistryEntry("a1", "Hall", null))
        fun add(entity: String, device: String, platform: String, state: String, attrs: Map<String, String> = emptyMap()) {
            gw.devices.add(HaDeviceRegistryEntry(id = device, name = device, area_id = "a1", identifiers = listOf(listOf("x", device))))
            gw.entityRegistry.add(HaEntityRegistryEntry(entity_id = entity, device_id = device, platform = platform, original_name = entity))
            gw.states.add(HaEntityState(entity, state, (attrs + ("friendly_name" to entity)).mapValues { JsonPrimitive(it.value) }))
        }
        add("binary_sensor.front_door", "door", "binary_sensor", "on", mapOf("device_class" to "door"))
        add("sensor.heater_power", "heater", "sensor", "1500", mapOf("device_class" to "power", "unit_of_measurement" to "W"))
        val hs = HouseholdService(db, clock)
        val bus = InProcessEventBus()
        val things = ThingsService(gw, db, hs, bus = bus)
        val svc = AlertsService(db, bus, things, NotificationsService(db, bus, hs, clock), clock, gw)
        return Env(svc, things, db, gw, Caller("h1", "u1", Role.ADMIN, true))
    }

    private fun active(e: Env, kind: String) = e.svc.list(e.caller).filter { it.kind == kind }

    @Test
    fun `a door open past the threshold raises one alert, which updates and then clears when it closes`() = runBlocking {
        val e = env()
        val attrs = mapOf<String, Any?>("device_class" to "door")
        e.svc.evaluateLeftOpen("h1", "conn-1", "binary_sensor.front_door", "on", attrs, iso(5))
        assertTrue(active(e, "left_open").isEmpty(), "open for 5 minutes is under the 10 minute threshold")
        e.svc.evaluateLeftOpen("h1", "conn-1", "binary_sensor.front_door", "on", attrs, iso(15))
        assertEquals(1, active(e, "left_open").size)
        e.svc.evaluateLeftOpen("h1", "conn-1", "binary_sensor.front_door", "on", attrs, iso(20))
        assertEquals(1, active(e, "left_open").size, "the same alert is updated, not duplicated")
        e.svc.clearLeftOpenFor("h1", "conn-1", "binary_sensor.front_door")
        assertTrue(active(e, "left_open").isEmpty())
    }

    @Test
    fun `a household threshold from the entity settings is respected`() = runBlocking {
        val e = env()
        e.things.updateSettings("h1", "conn-1", "binary_sensor.front_door", null, null, leftOpenAfterMs = 60_000L)
        e.svc.evaluateLeftOpen("h1", "conn-1", "binary_sensor.front_door", "on", mapOf("device_class" to "door"), iso(2))
        assertEquals(1, active(e, "left_open").size)
    }

    @Test
    fun `power above the limit raises an alert and dropping below clears it`() = runBlocking {
        val e = env()
        e.things.updateSettings("h1", "conn-1", "sensor.heater_power", 1000, null)
        val attrs = mapOf<String, Any?>("device_class" to "power", "unit_of_measurement" to "W")
        e.svc.evaluatePower("h1", "conn-1", "sensor.heater_power", "1500", attrs)
        assertEquals(1, active(e, "power_limit").size)
        e.svc.evaluatePower("h1", "conn-1", "sensor.heater_power", "400", attrs)
        assertTrue(active(e, "power_limit").isEmpty())
    }

    @Test
    fun `no limit set means no power alert`() = runBlocking {
        val e = env()
        e.svc.evaluatePower("h1", "conn-1", "sensor.heater_power", "9000", mapOf("device_class" to "power", "unit_of_measurement" to "W"))
        assertTrue(active(e, "power_limit").isEmpty())
    }

    @Test
    fun `a limit set by one household does not raise alerts in another`() = runBlocking {
        val e = env()
        e.db.write { identityQueries.insertHousehold("h2", "Other", 2); identityQueries.insertHouseholdSettings("h2") }
        e.things.updateSettings("h2", "conn-1", "sensor.heater_power", 100, null)
        e.svc.evaluatePower("h1", "conn-1", "sensor.heater_power", "1500", mapOf("device_class" to "power", "unit_of_measurement" to "W"))
        assertTrue(active(e, "power_limit").isEmpty(), "h1 never set a limit")
    }

    @Test
    fun `the sweep raises alerts for doors already open and clears the ones that closed`() = runBlocking {
        val e = env()
        e.gw.states.removeAll { it.entity_id == "binary_sensor.front_door" }
        e.gw.states.add(HaEntityState("binary_sensor.front_door", "on", mapOf("device_class" to JsonPrimitive("door"), "friendly_name" to JsonPrimitive("Front door")), last_changed = iso(30)))
        e.svc.sweepLeftOpen("h1")
        assertEquals(1, active(e, "left_open").size)
        e.gw.states.removeAll { it.entity_id == "binary_sensor.front_door" }
        e.gw.states.add(HaEntityState("binary_sensor.front_door", "off", mapOf("device_class" to JsonPrimitive("door"), "friendly_name" to JsonPrimitive("Front door"))))
        e.svc.sweepLeftOpen("h1")
        assertTrue(active(e, "left_open").isEmpty())
    }
}
