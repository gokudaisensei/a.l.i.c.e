package alice.server.modes

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class ModesServiceTest {
    @Test
    fun `get returns home by default`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
        }
        val svc = ModesService(db, SystemTimeProvider)
        assertEquals("home", svc.get("h1").mode)
    }

    @Test
    fun `set changes mode and returns new state`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
        }
        val svc = ModesService(db, SystemTimeProvider)
        val r = svc.set("h1", "u1", "away")
        assertEquals("away", r.mode)
        assertEquals("away", svc.get("h1").mode)
    }

    @Test
    fun `set to same mode is a no-op`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
        }
        val svc = ModesService(db, SystemTimeProvider)
        svc.set("h1", "u1", "away")
        val r = svc.set("h1", "u1", "away")
        assertEquals("away", r.mode)
    }

    @Test
    fun `invalid mode throws`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
        }
        val svc = ModesService(db, SystemTimeProvider)
        assertThrows(Exception::class.java) { svc.set("h1", "u1", "invalid") }
    }
}
