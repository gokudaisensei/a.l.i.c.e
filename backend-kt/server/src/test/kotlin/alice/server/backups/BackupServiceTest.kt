package alice.server.backups

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.ConfigJobService
import alice.server.notifications.NotificationsService
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.Base64
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BackupServiceTest {
    private fun service(
        dir: Path,
        env: Map<String, String> = emptyMap(),
        snapshotFrom: String? = null,
        clock: alice.core.time.TimeProvider = SystemTimeProvider,
    ): Pair<BackupService, Database> {
        val file = dir.resolve("alice.db").toString()
        val db = Database(DatabaseFactory.open(file))
        db.write {
            identityQueries.insertUser("u1", "A", 1); identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1); identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
            identityQueries.insertSession("s1", "u1", "hash", 1, 9_999_999_999_999, 1, null, null, 0)
        }
        val config = AppConfig(database = DatabaseConfig(path = snapshotFrom ?: file))
        val notifications = NotificationsService(db, alice.core.events.InProcessEventBus(), alice.server.households.HouseholdService(db, SystemTimeProvider), SystemTimeProvider)
        return BackupService(db, ConfigJobService(db), notifications, config, clock) { env[it] } to db
    }

    @Test
    fun `the backup folder sits beside the database`(@TempDir dir: Path) {
        assertEquals(dir.resolve("backups").toFile().absoluteFile, backupDir(dir.resolve("alice.db").toString()))
    }

    @Test
    fun `a key that is set but unusable stops startup instead of writing unencrypted backups`(@TempDir dir: Path) {
        assertFailsWith<IllegalArgumentException> { service(dir, mapOf("BACKUP_ENCRYPTION_KEY" to "not-a-key")) }
        assertFailsWith<IllegalArgumentException> { service(java.nio.file.Files.createDirectory(dir.resolve("second")), mapOf("BACKUP_ENCRYPTION_KEY" to Base64.getEncoder().encodeToString(ByteArray(16)))) }
    }

    @Test
    fun `a backup is written whole, restores to the data and leaves no partial file`(@TempDir dir: Path) {
        val key = Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() })
        val (svc, _) = service(dir, mapOf("BACKUP_ENCRYPTION_KEY" to key))
        val made = svc.createApp("h1", "manual", "u1")
        assertEquals("ok", made.status, made.error)
        assertTrue(made.encrypted)
        val files = dir.resolve("backups").listDirectoryEntries()
        assertEquals(1, files.size)
        assertTrue(files.none { it.toString().endsWith(".partial") })
        val verified = svc.verify("h1", made.id)
        assertEquals("passed", verified.verify.status, verified.verify.note)
    }

    @Test
    fun `without a key backups are plain gzip and say so`(@TempDir dir: Path) {
        val (svc, _) = service(dir)
        val made = svc.createApp("h1", "manual", "u1")
        assertEquals("ok", made.status, made.error)
        assertEquals(false, made.encrypted)
        assertNull(made.error)
        assertTrue(dir.resolve("backups").exists())
    }

    @Test
    fun `a backup left running by a crash is marked failed and its partial file removed`(@TempDir dir: Path) {
        val (svc, db) = service(dir)
        db.write {
            coreQueries.insertBackupRecord("bkp_stuck", "h1", "app", "local", null, "x.db.gz", null, null, 0, null, "running", null, "manual", "u1", 1L, null, "none", null, null)
        }
        val partial = dir.resolve("backups").also { java.nio.file.Files.createDirectories(it) }.resolve("x.db.gz.partial")
        java.nio.file.Files.writeString(partial, "half")
        assertEquals(1, svc.recoverInterrupted())
        assertEquals("failed", svc.get("h1", "bkp_stuck").status)
        assertTrue(!partial.exists())
        assertEquals(0, svc.recoverInterrupted())
    }

    @Test
    fun `a failed scheduled backup is retried after an hour, and a good one finishes the day`(@TempDir dir: Path) {
        var t = java.time.ZonedDateTime.of(2026, 5, 1, 3, 0, 0, 0, java.time.ZoneId.of("UTC")).toInstant().toEpochMilli()
        val clock = alice.core.time.TimeProvider { t }
        // The snapshot source does not exist, so every attempt fails.
        val (svc, _) = service(dir, snapshotFrom = dir.resolve("missing.db").toString(), clock = clock)
        svc.tick()
        assertEquals(1, svc.list("h1").size)
        assertEquals("failed", svc.list("h1").single().status)
        t += 5 * 60_000; svc.tick()
        assertEquals(1, svc.list("h1").size, "no retry within the hour")
        t += 60 * 60_000; svc.tick()
        assertEquals(2, svc.list("h1").size, "retried after an hour")
        assertNull(svc.settings("h1").lastScheduledDay, "a day with no backup is not marked done")
    }

    @Test
    fun `a successful scheduled backup marks the day done and is not repeated`(@TempDir dir: Path) {
        var t = java.time.ZonedDateTime.of(2026, 5, 1, 3, 0, 0, 0, java.time.ZoneId.of("UTC")).toInstant().toEpochMilli()
        val clock = alice.core.time.TimeProvider { t }
        val (svc, _) = service(dir, clock = clock)
        svc.tick()
        assertEquals("ok", svc.list("h1").single().status)
        assertEquals("2026-05-01", svc.settings("h1").lastScheduledDay)
        t += 2 * 3_600_000; svc.tick()
        assertEquals(1, svc.list("h1").size)
        t += 24 * 3_600_000; svc.tick()
        assertEquals(2, svc.list("h1").size, "the next day gets its own backup")
    }

    @Test
    fun `saving the form and the scheduler marking a day do not overwrite each other`(@TempDir dir: Path) {
        var t = java.time.ZonedDateTime.of(2026, 5, 1, 3, 0, 0, 0, java.time.ZoneId.of("UTC")).toInstant().toEpochMilli()
        val clock = alice.core.time.TimeProvider { t }
        val (svc, _) = service(dir, clock = clock)
        val days = 15
        val saving = java.util.concurrent.atomic.AtomicBoolean(true)
        val lastKeep = java.util.concurrent.atomic.AtomicInteger(14)
        val writer = Thread {
            var n = 0
            while (saving.get()) { val keep = (n++ % 60) + 1; svc.updateSettings("h1", "u1", mapOf("keep" to keep)); lastKeep.set(keep) }
        }
        writer.start()
        repeat(days) { svc.tick(); t += 24 * 3_600_000 }
        saving.set(false); writer.join()
        val finalSettings = svc.settings("h1")
        assertEquals("2026-05-15", finalSettings.lastScheduledDay, "every day the scheduler marked must survive the saves")
        assertEquals(lastKeep.get(), finalSettings.keep, "and the last saved form value must survive the marks")
        // (the number of backups left is not checked: retention trims them to the changing "keep" value)
    }
}
