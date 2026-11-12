package alice.server.backups

import alice.core.db.AliceDb
import alice.core.db.DatabaseFactory
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.sql.DriverManager
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RestoreApplyTest {
    private fun makeDb(file: Path, userName: String, withHousehold: Boolean = true) {
        DatabaseFactory.open(file.toString()).use { h ->
            if (withHousehold) {
                h.db.identityQueries.insertUser("u1", userName, 1)
                h.db.identityQueries.insertHousehold("h1", "Home", 1)
            }
        }
    }

    private fun userName(file: Path): String? = DriverManager.getConnection("jdbc:sqlite:$file").use { c ->
        c.createStatement().use { st -> st.executeQuery("select display_name from users limit 1").use { rs -> if (rs.next()) rs.getString(1) else null } }
    }

    private fun stage(dir: Path, build: (Path) -> Unit): Path {
        val live = dir.resolve("alice.db"); makeDb(live, "current")
        build(dir.resolve("alice.db.restore-pending"))
        return live
    }

    @Test
    fun `a good staged backup replaces the database and the old one is kept with its log`(@TempDir dir: Path) {
        val live = stage(dir) { makeDb(it, "from backup") }
        Files.writeString(dir.resolve("alice.db-wal"), "recent changes not yet in the main file")
        val (applied, note) = RestoreApply.applyPendingRestore(live.toString(), now = 7)
        assertTrue(applied, note)
        // Read the log first: opening a database next to a leftover log lets SQLite tidy that log away.
        assertEquals("recent changes not yet in the main file", Files.readString(dir.resolve("alice.db.before-restore-7-wal")), "the old log is kept, not deleted")
        assertEquals("from backup", userName(live))
        assertEquals("current", userName(dir.resolve("alice.db.before-restore-7")))
        assertFalse(dir.resolve("alice.db.restore-pending").exists())
    }

    @Test
    fun `a damaged file is set aside and the live database is untouched`(@TempDir dir: Path) {
        val live = stage(dir) { Files.write(it, ByteArray(4096) { b -> (b * 7).toByte() }) }
        val (applied, note) = RestoreApply.applyPendingRestore(live.toString(), now = 7)
        assertFalse(applied); assertTrue(note.contains("set aside"), note)
        assertEquals("current", userName(live))
        assertTrue(dir.listDirectoryEntries().any { it.fileName.toString().startsWith("alice.db.restore-pending.rejected-") })
    }

    @Test
    fun `a backup from a newer version of Alice is refused`(@TempDir dir: Path) {
        val live = stage(dir) { makeDb(it, "newer") ; DriverManager.getConnection("jdbc:sqlite:$it").use { c -> c.createStatement().use { st -> st.execute("PRAGMA user_version = ${AliceDb.Schema.version + 3}") } } }
        val (applied, note) = RestoreApply.applyPendingRestore(live.toString(), now = 7)
        assertFalse(applied); assertTrue(note.contains("newer version"), note)
        assertEquals("current", userName(live))
    }

    @Test
    fun `a backup with no users or household is refused rather than wiping the install`(@TempDir dir: Path) {
        val live = stage(dir) { makeDb(it, "x", withHousehold = false) }
        val (applied, note) = RestoreApply.applyPendingRestore(live.toString(), now = 7)
        assertFalse(applied); assertTrue(note.contains("no users"), note)
        assertEquals("current", userName(live))
    }

    @Test
    fun `if swapping in the new file fails the old database and its log are put back`(@TempDir dir: Path) {
        val live = stage(dir) { makeDb(it, "from backup") }
        Files.writeString(dir.resolve("alice.db-wal"), "log")
        val pendingFile = dir.resolve("alice.db.restore-pending")
        val move = { from: Path, to: Path ->
            if (from == pendingFile && to == live) throw java.io.IOException("disk full")
            Files.move(from, to, java.nio.file.StandardCopyOption.REPLACE_EXISTING); Unit
        }
        val (applied, note) = RestoreApply.applyPendingRestore(live.toString(), now = 7, move = move)
        assertFalse(applied); assertTrue(note.contains("put back"), note)
        assertEquals("log", Files.readString(dir.resolve("alice.db-wal")), "its log is back where it was")
        assertEquals("current", userName(live), "and the original database is where it was")
        assertTrue(pendingFile.exists(), "the staged file is still there to try again")
    }
}
