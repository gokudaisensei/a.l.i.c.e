package alice.server.favorites

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class FavoritesServiceTest {
    @Test
    fun `save and retrieve favorites`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write { identityQueries.insertUser("u1", "Gokul", 1000) }
        val svc = FavoritesService(db)
        svc.save("u1", listOf("conn-1" to "device:echo", "conn-1" to "device:floor"))
        val ids = svc.idsFor("u1")
        assertEquals(2, ids.size)
        assertEquals("device:echo", ids[0])
    }

    @Test
    fun `empty favorites returns empty list`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write { identityQueries.insertUser("u1", "Gokul", 1000) }
        val svc = FavoritesService(db)
        assertEquals(0, svc.idsFor("u1").size)
    }
}
