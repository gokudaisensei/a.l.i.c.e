package alice.server.users

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class UserServiceTest {
    @Test
    fun `get returns user`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write { identityQueries.insertUser("u1", "Gokul", 1000) }
        val svc = UserService(db)
        assertEquals("Gokul", svc.get("u1").displayName)
    }

    @Test
    fun `update changes display name`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write { identityQueries.insertUser("u1", "Gokul", 1000) }
        val svc = UserService(db)
        val u = svc.update("u1", "Gokul K", null, null)
        assertEquals("Gokul K", u.displayName)
    }

    @Test
    fun `update rejects empty name`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write { identityQueries.insertUser("u1", "Gokul", 1000) }
        val svc = UserService(db)
        assertThrows(Exception::class.java) { svc.update("u1", "  ", null, null) }
    }

    @Test
    fun `get throws for unknown user`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        val svc = UserService(db)
        assertThrows(Exception::class.java) { svc.get("nope") }
    }
}
