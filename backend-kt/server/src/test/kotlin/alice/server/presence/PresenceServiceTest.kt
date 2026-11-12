package alice.server.presence

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.server.households.HouseholdService
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class PresenceServiceTest {
    @Test
    fun `people returns members with null person link`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val hs = HouseholdService(db, SystemTimeProvider)
        val svc = PresenceService(db, hs, SystemTimeProvider)
        val r = svc.people("h1")
        assertEquals(1, r.people.size)
        assertEquals("u1", r.people[0].userId)
        assertEquals(null, r.people[0].personEntityId)
    }

    @Test
    fun `link throws for unknown member`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
        }
        val hs = HouseholdService(db, SystemTimeProvider)
        val svc = PresenceService(db, hs, SystemTimeProvider)
        assertThrows(Exception::class.java) { runBlocking { svc.link("h1", "u1", "nope", "person.x") } }
    }
}
