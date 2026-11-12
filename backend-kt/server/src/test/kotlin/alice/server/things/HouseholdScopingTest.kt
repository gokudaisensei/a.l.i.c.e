package alice.server.things

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HouseholdScopingTest {
    private fun seed(db: Database) = db.write {
        identityQueries.insertUser("u1", "A", 1)
        for (h in listOf("h1", "h2")) { identityQueries.insertHousehold(h, h, 1); identityQueries.insertHouseholdSettings(h) }
    }

    @Test
    fun `two households with the same entity id keep separate settings`() {
        val db = Database(DatabaseFactory.open(":memory:")); seed(db)
        val things = ThingsService(alice.ha.FakeGateway(), db, alice.server.households.HouseholdService(db, SystemTimeProvider))
        things.updateSettings("h1", "conn-1", "light.kitchen", 100, null)
        things.updateSettings("h2", "conn-1", "light.kitchen", 900, null)
        assertEquals(100, things.getSettings("h1", "conn-1", "light.kitchen")?.powerLimitW)
        assertEquals(900, things.getSettings("h2", "conn-1", "light.kitchen")?.powerLimitW)
        assertNull(things.getSettings("h3", "conn-1", "light.kitchen"))
    }

    @Test
    fun `an old database keeps its settings and overrides when it is upgraded`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        // A version-2 database: create it, then put the old single-connection table back by hand.
        DatabaseFactory.open(file.toString()).use { h ->
            val db = Database(h); seed(db)
        }
        java.sql.DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { st ->
                st.execute("DROP TABLE entity_settings")
                st.execute("CREATE TABLE entity_settings (connection_id TEXT NOT NULL, entity_id TEXT NOT NULL, household_id TEXT NOT NULL REFERENCES households (id) ON DELETE CASCADE, power_limit_w INTEGER, left_open_after_ms INTEGER, voice_exposed INTEGER NOT NULL DEFAULT 0, voice_sync_status TEXT NOT NULL DEFAULT 'none', voice_sync_error TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (connection_id, entity_id))")
                st.execute("INSERT INTO entity_settings VALUES ('conn-1','light.a','h1',50,NULL,1,'none',NULL,1)")
                st.execute("PRAGMA user_version = 2")
            }
        }
        DatabaseFactory.open(file.toString()).use { h ->
            val db = Database(h)
            assertEquals(50L, db.read { identityQueries.selectEntitySettings("h1", "conn-1", "light.a").executeAsOne().power_limit_w })
            db.write { identityQueries.upsertEntitySettings("conn-1", "light.a", "h2", 70, null, 0, "none", null, 2) }
            assertEquals(50L, db.read { identityQueries.selectEntitySettings("h1", "conn-1", "light.a").executeAsOne().power_limit_w })
        }
    }
}
