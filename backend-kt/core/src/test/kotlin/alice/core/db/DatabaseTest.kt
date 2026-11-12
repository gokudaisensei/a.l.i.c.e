package alice.core.db

import alice.core.ids.Ids
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.slf4j.LoggerFactory
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DatabaseTest {

    private fun setVersion(file: Path, version: Long) {
        DriverManager.getConnection("jdbc:sqlite:$file").use { it.createStatement().use { s -> s.execute("PRAGMA user_version = $version") } }
    }

    private fun version(file: Path): Long =
        DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { s -> s.executeQuery("PRAGMA user_version").use { rs -> rs.next(); rs.getLong(1) } }
        }

    @Test
    fun `a file database keeps its data and its version across reopening`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        DatabaseFactory.open(file.toString()).use { h ->
            h.db.coreQueries.insertAuditLog(Ids.next("aud"), null, "system", null, "test.keep", null, null, 1L)
        }
        assertEquals(AliceDb.Schema.version, version(file))
        DatabaseFactory.open(file.toString()).use { h ->
            assertEquals(1L, h.db.coreQueries.countAuditLog().executeAsOne())
        }
    }

    @Test
    fun `a database from a newer build is refused instead of being stamped as current`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        DatabaseFactory.open(file.toString()).close()
        setVersion(file, AliceDb.Schema.version + 5)
        assertFailsWith<IllegalStateException> { DatabaseFactory.open(file.toString()) }
        assertEquals(AliceDb.Schema.version + 5, version(file), "the refused database must be left as it was")
    }

    @Test
    fun `an existing empty file is initialised and warns`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        Files.createFile(file)
        val logger = LoggerFactory.getLogger(DatabaseFactory::class.java) as Logger
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(appender)
        try {
            DatabaseFactory.open(file.toString()).use { h ->
                assertEquals(0L, h.db.coreQueries.countAuditLog().executeAsOne())
            }
            assertTrue(
                appender.list.any { it.level == Level.WARN && it.formattedMessage.contains("empty") },
                "an existing empty database must be reported: ${appender.list.map { it.formattedMessage }}",
            )
        } finally {
            logger.detachAppender(appender)
        }
    }

    @Test
    fun `a file that is not a database fails and is left unchanged`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        val original = "this is not a sqlite database, and it must not be replaced\n".toByteArray()
        Files.write(file, original)
        assertFailsWith<IllegalStateException> { DatabaseFactory.open(file.toString()) }
        assertContentEquals(original, Files.readAllBytes(file), "the unreadable file must be left exactly as it was")
    }

    @Test
    fun `foreign keys are on before the schema is created`() {
        DatabaseFactory.open(DatabaseFactory.MEMORY).use { h ->
            val enabled = h.driver.executeQuery(
                null,
                "PRAGMA foreign_keys",
                { cursor -> app.cash.sqldelight.db.QueryResult.Value(if (cursor.next().value) cursor.getLong(0) else 0L) },
                0,
            ).value
            assertEquals(1L, enabled)
        }
    }

    @Test
    fun `a database with no recorded version opens as the current one`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        DatabaseFactory.open(file.toString()).close()
        setVersion(file, 0)
        DatabaseFactory.open(file.toString()).use { h -> assertEquals(0L, h.db.coreQueries.countAuditLog().executeAsOne()) }
        assertEquals(AliceDb.Schema.version, version(file))
    }

    @Test
    fun `schema is created and audit rows round-trip`() {
        DatabaseFactory.open(DatabaseFactory.MEMORY).use { handle ->
            val db = handle.db

            assertEquals(0L, db.coreQueries.countAuditLog().executeAsOne())

            db.coreQueries.insertAuditLog(
                id = Ids.next("aud"),
                household_id = null,
                actor_type = "system",
                actor_id = null,
                action = "test.ping",
                resource = "/health",
                detail = null,
                created_at = 1_700_000_000_000,
            )

            assertEquals(1L, db.coreQueries.countAuditLog().executeAsOne())

            val latest = db.coreQueries.selectRecentAuditLog(1).executeAsOne()
            assertEquals("test.ping", latest.action)
            assertTrue(latest.id.startsWith("aud_"))
        }
    }

    @Test
    fun `settings upsert keeps the last value`() {
        DatabaseFactory.open(DatabaseFactory.MEMORY).use { handle ->
            val db = handle.db

            db.coreQueries.upsertSetting("updates.auto", "{\"enabled\":false}", 1)
            db.coreQueries.upsertSetting("updates.auto", "{\"enabled\":true}", 2)

            assertEquals("{\"enabled\":true}", db.coreQueries.selectSetting("updates.auto").executeAsOne())
        }
    }

    private fun seedHousehold(h: DatabaseHandle) {
        h.db.identityQueries.insertUser("u1", "A", 1)
        h.db.identityQueries.insertHousehold("h1", "H", 1)
    }

    @Test
    fun `a role that is not admin, member or guest is refused, a valid one is accepted`() {
        DatabaseFactory.open(DatabaseFactory.MEMORY).use { h ->
            seedHousehold(h)
            h.db.identityQueries.insertHouseholdMember("m1", "h1", "u1", "guest", null, 1)
            assertFailsWith<Exception> { h.db.identityQueries.insertHouseholdMember("m2", "h1", "u1", "boss", null, 1) }
            assertFailsWith<Exception> { h.db.identityQueries.insertInvitation("i1", "h1", "hash", "root", null, "u1", 1, 2) }
        }
    }

    @Test
    fun `an update to an unknown value is refused too`() {
        DatabaseFactory.open(DatabaseFactory.MEMORY).use { h ->
            seedHousehold(h)
            h.db.identityQueries.insertHouseholdMember("m1", "h1", "u1", "guest", null, 1)
            assertFailsWith<Exception> { h.db.identityQueries.updateHouseholdMemberRole("boss", "m1") }
            h.db.identityQueries.updateHouseholdMemberRole("member", "m1")
        }
    }

    @Test
    fun `an old database that already holds an unknown value still opens`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db")
        DatabaseFactory.open(file.toString()).use { h -> seedHousehold(h) }
        DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
            c.createStatement().use { st ->
                st.execute("DROP TRIGGER household_members_role_valid_insert")
                st.execute("INSERT INTO household_members (id, household_id, user_id, role, joined_at) VALUES ('old','h1','u1','legacy',1)")
            }
        }
        DatabaseFactory.open(file.toString()).use { h ->
            assertEquals(1L, h.db.identityQueries.countHouseholdAdmins("h1").executeAsOne() + 1L, "the database opens and can be queried")
            assertFailsWith<Exception> { h.db.identityQueries.insertHouseholdMember("new", "h1", "u1", "legacy", null, 2) }
        }
    }

    @Test
    fun `unknown push platforms, alert kinds and routine run states are refused`() {
        DatabaseFactory.open(DatabaseFactory.MEMORY).use { h ->
            seedHousehold(h)
            val q = h.db.identityQueries
            q.insertPushSubscription("p1", "u1", "webpush", "tok", null, null, 1, null)
            assertFailsWith<Exception> { q.insertPushSubscription("p2", "u1", "carrier-pigeon", "tok2", null, null, 1, null) }
            q.insertAlert("a1", "h1", "left_open", "conn-1", "e", "r", "t", "d", null, 1, null, null, null)
            assertFailsWith<Exception> { q.insertAlert("a2", "h1", "mystery", "conn-1", "e", "r", "t", "d", null, 1, null, null, null) }
        }
    }
}
