package alice.server.smart

import alice.core.config.SmartConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FacetValues
import alice.ha.FakeGateway
import alice.server.households.HouseholdService
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SmartCompletionTest {
    private fun setup(config: SmartConfig = SmartConfig()): Pair<SmartService, Caller> {
        val db = Database(DatabaseFactory.open(":memory:"))
        val hs = HouseholdService(db, SystemTimeProvider)
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val things = ThingsService(FakeGateway(), db, hs)
        val smart = SmartService(db, things, SystemTimeProvider, smartConfig = config)
        return smart to Caller("h1", "u1", alice.server.households.Role.ADMIN, false)
    }

    @Test fun `hints kill switch does not break home`() = runBlocking {
        val (smart, caller) = setup(SmartConfig(hints = false))
        repeat(6) { smart.recordCommand("h1", "u1", "t1") }
        repeat(4) { smart.recordUndo("h1", "u1", "t1") }
        smart.rememberDefault("h1", "u1", "t1", "set_brightness", """{"brightnessPct":50}""")
        val home = smart.home(caller)
        assertTrue(home.devices.isEmpty())
        assertTrue(smart.confirmIntent("h1", "u1", "t1"))
    }

    @Test fun `search kill switch returns basic behavior`() = runBlocking {
        val (smart, caller) = setup(SmartConfig(search = false))
        val res = smart.search(caller, "anything")
        assertTrue(res.results.isEmpty())
        assertTrue(res.suggestions.isEmpty())
    }

    @Test fun `scenes kill switch returns no scene chips`() = runBlocking {
        val (smart, caller) = setup(SmartConfig(scenes = false))
        repeat(3) { smart.recordSceneRun("h1", "u1", "morning") }
        val home = smart.home(caller)
        assertTrue(home.scenes.isEmpty())
    }

    @Test fun `facet polarity suggestion behavior`() {
        val f = FacetValues.describeFacet("door", "binary_sensor.door", "binary_sensor", "door", "Door", "on")
        assertEquals("open", f.value)
        assertFalse(f.ambiguous)
        val amb = FacetValues.describeFacet("shutter", "binary_sensor.cam", "binary_sensor", null, "Camera shutter", "on")
        assertTrue(amb.ambiguous)
        assertNull(amb.suggestion)
        val known = FacetValues.describeFacet("x", "binary_sensor.x", "binary_sensor", "motion", "Motion", "on")
        assertFalse(known.ambiguous)
    }
}
