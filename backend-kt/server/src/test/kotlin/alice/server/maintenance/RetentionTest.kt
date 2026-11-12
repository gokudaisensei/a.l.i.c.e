package alice.server.maintenance

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.TimeProvider
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.sql.DriverManager
import kotlin.test.Test
import kotlin.test.assertEquals

class RetentionTest {
    private val day = 24 * 3_600_000L
    private val now = 1_800_000_000_000L
    private val clock = object : TimeProvider { override fun now() = now }

    private fun count(file: Path, table: String): Int =
        DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { st -> st.executeQuery("SELECT count(*) FROM $table").use { it.next(); it.getInt(1) } }
        }

    @Test
    fun `old finished rows go and current ones stay`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        DatabaseFactory.open(file.toString()).use { h ->
            val db = Database(h)
            db.write {
                identityQueries.insertUser("u1", "A", 1)
                identityQueries.insertHousehold("h1", "H", 1)
            }
        }
        DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { st ->
                fun sql(s: String) = st.execute(s)
                // sessions: expired long ago, revoked long ago, still valid
                sql("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at) VALUES ('old','u1','a',1,${now - 10 * day},1,NULL)")
                sql("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at) VALUES ('rev','u1','b',1,${now + day},1,${now - 10 * day})")
                sql("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at) VALUES ('live','u1','c',1,${now + day},1,NULL)")
                // challenges: one expired (it may hold an invitation code), one live
                sql("INSERT INTO webauthn_challenges (id, challenge, purpose, data, expires_at) VALUES ('c1','x','register','{\"inviteCode\":\"secret\"}',${now - 1})")
                sql("INSERT INTO webauthn_challenges (id, challenge, purpose, expires_at) VALUES ('c2','y','register',${now + 60_000})")
                // notifications: read long ago, unread recent, unread ancient
                sql("INSERT INTO notifications (id, household_id, user_id, kind, title, body, created_at, read_at) VALUES ('n1','h1','u1','k','t','b',1,${now - 100 * day})")
                sql("INSERT INTO notifications (id, household_id, user_id, kind, title, body, created_at) VALUES ('n2','h1','u1','k','t','b',${now - day})")
                sql("INSERT INTO notifications (id, household_id, user_id, kind, title, body, created_at) VALUES ('n3','h1','u1','k','t','b',${now - 400 * day})")
                // alerts: cleared long ago, still active
                sql("INSERT INTO alerts (id, household_id, kind, connection_id, entity_id, thing_ref, title, detail, created_at, cleared_at) VALUES ('a1','h1','left_open','conn-1','e','r','t','d',1,${now - 100 * day})")
                sql("INSERT INTO alerts (id, household_id, kind, connection_id, entity_id, thing_ref, title, detail, created_at) VALUES ('a2','h1','left_open','conn-1','e','r','t','d',1)")
            }
        }
        DatabaseFactory.open(file.toString()).use { h -> Retention(Database(h), clock).run() }
        assertEquals(1, count(file, "sessions"))
        assertEquals(1, count(file, "webauthn_challenges"))
        assertEquals(1, count(file, "notifications"))
        assertEquals(1, count(file, "alerts"))
    }
}
