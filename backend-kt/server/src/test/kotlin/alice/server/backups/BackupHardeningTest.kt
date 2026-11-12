package alice.server.backups

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.error.AppException
import alice.core.time.SystemTimeProvider
import alice.ha.ConfigJobService
import alice.server.households.HouseholdService
import alice.server.notifications.NotificationsService
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assumptions
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class BackupHardeningTest {
    private data class Env(val svc: BackupService, val db: Database, val jobs: ConfigJobService)

    private fun env(dir: Path): Env {
        val dbFile = dir.resolve("alice.db")
        val db = Database(DatabaseFactory.open(dbFile.toString()))
        db.write {
            for (h in listOf("h1", "h2")) {
                identityQueries.insertUser("u-$h", "User $h", 1)
                identityQueries.insertHousehold(h, "Home $h", 1)
                identityQueries.insertHouseholdSettings(h)
                identityQueries.insertHouseholdMember("m-$h", h, "u-$h", "admin", null, 1)
                identityQueries.insertHaConnection("conn-$h", h, "HA $h", "http://ha", "tok", "admin", "connected", 1, 1)
            }
        }
        val jobs = ConfigJobService(db)
        val notifications = NotificationsService(db, alice.core.events.InProcessEventBus(), HouseholdService(db, SystemTimeProvider), SystemTimeProvider)
        val config = AppConfig(database = DatabaseConfig(path = dbFile.toString()))
        return Env(BackupService(db, jobs, notifications, config, SystemTimeProvider), db, jobs)
    }

    private fun setStoredNasPath(db: Database, path: String) {
        val row = db.read { identityQueries.selectHouseholdSettings("h1").executeAsOne() }
        val root = row.settings?.let { Json.parseToJsonElement(it).jsonObject.toMutableMap() } ?: mutableMapOf()
        val backups = (root["backups"] as? JsonObject)?.toMutableMap() ?: mutableMapOf()
        backups["nasPath"] = JsonPrimitive(path)
        root["backups"] = JsonObject(backups)
        db.write { identityQueries.updateHouseholdSettingsSettings(JsonObject(root).toString(), "h1") }
    }

    @Test
    fun `a normal NAS directory is accepted and stored canonical`(@TempDir dir: Path) {
        val e = env(dir)
        val nas = Files.createDirectory(dir.resolve("nas"))
        val settings = e.svc.updateSettings("h1", "u-h1", mapOf("destination" to "nas", "nasPath" to nas.toString()))
        assertEquals("nas", settings.destination)
        assertEquals(nas.toFile().canonicalPath, settings.nasPath)
        assertEquals(nas.toFile().canonicalPath, e.svc.settings("h1").nasPath)
    }

    @Test
    fun `roots protected locations files the database folder and symlinks are refused`(@TempDir dir: Path) {
        val e = env(dir)
        for (bad in listOf("/", "/etc", "/proc/self", dir.toString())) {
            assertEquals(400, assertFailsWith<AppException> {
                e.svc.updateSettings("h1", "u-h1", mapOf("destination" to "nas", "nasPath" to bad))
            }.status, bad)
        }
        val file = Files.writeString(dir.resolve("not-a-dir"), "x")
        assertEquals(400, assertFailsWith<AppException> {
            e.svc.updateSettings("h1", "u-h1", mapOf("destination" to "nas", "nasPath" to file.toString()))
        }.status)
        val link = Files.createSymbolicLink(dir.resolve("link"), Path.of("/etc"))
        assertEquals(400, assertFailsWith<AppException> {
            e.svc.updateSettings("h1", "u-h1", mapOf("destination" to "nas", "nasPath" to link.toString()))
        }.status)
    }

    @Test
    fun `a read-only directory is refused unless the test runs as root`(@TempDir dir: Path) {
        Assumptions.assumeFalse(System.getProperty("user.name") == "root")
        val e = env(dir)
        val ro = Files.createDirectory(dir.resolve("readonly"))
        ro.toFile().setWritable(false)
        try {
            assertEquals(400, assertFailsWith<AppException> {
                e.svc.updateSettings("h1", "u-h1", mapOf("destination" to "nas", "nasPath" to ro.toString()))
            }.status)
        } finally {
            ro.toFile().setWritable(true)
        }
    }

    @Test
    fun `a swapped symlink or tampered setting cannot redirect a backup`(@TempDir dir: Path) {
        val e = env(dir)
        val safe = Files.createDirectory(dir.resolve("safe"))
        val link = dir.resolve("nas-link")
        Files.createSymbolicLink(link, safe)
        e.svc.updateSettings("h1", "u-h1", mapOf("destination" to "nas", "nasPath" to link.toString()))
        // The stored value is the canonical safe folder, not the link.
        assertEquals(safe.toFile().canonicalPath, e.svc.settings("h1").nasPath)

        Files.delete(link)
        Files.createSymbolicLink(link, Path.of("/etc"))
        setStoredNasPath(e.db, link.toString())
        val made = e.svc.createApp("h1", "manual", "u-h1")
        assertEquals("failed", made.status)
        assertTrue((made.error ?: "").contains("protected", ignoreCase = true), made.error)
    }

    @Test
    fun `retention keeps the newest records even when rows are out of order`(@TempDir dir: Path) {
        val e = env(dir)
        e.svc.updateSettings("h1", "u-h1", mapOf("keep" to 1))
        e.db.write {
            coreQueries.insertBackupRecord("old", "h1", "app", "local", null, "old", null, null, 0, null, "ok", null, "manual", null, 1, 1, "passed", 1, null)
            coreQueries.insertBackupRecord("newest", "h1", "app", "local", null, "newest", null, null, 0, null, "ok", null, "manual", null, 3, 3, "passed", 3, null)
            coreQueries.insertBackupRecord("middle", "h1", "app", "local", null, "middle", null, null, 0, null, "ok", null, "manual", null, 2, 2, "passed", 2, null)
        }
        val retain = BackupService::class.java.getDeclaredMethod("retain", String::class.java, String::class.java)
        retain.isAccessible = true
        retain.invoke(e.svc, "h1", "app")
        assertEquals(listOf("newest"), e.svc.list("h1").map { it.id })
    }

    @Test
    fun `a job cannot update another household's backup record`(@TempDir dir: Path) {
        val e = env(dir)
        val now = System.currentTimeMillis()
        e.db.write {
            coreQueries.insertBackupRecord("bkp-h2", "h2", "ha", "ha", "ha-1", "h2", null, null, 0, null, "running", null, "manual", null, now, null, "none", null, null)
            coreQueries.insertBackupRecord("bkp-h1", "h1", "ha", "ha", "ha-1", "h1", null, null, 0, null, "running", null, "manual", null, now, null, "none", null, null)
        }
        val wrong = e.jobs.enqueue("h1", "backup.generate", """{"recordId":"bkp-h2"}""", null, null)!!
        e.db.write { identityQueries.updateConfigJobStatus("done", now, now, """{"backupId":"ha-x","sizeBytes":10}""", null, null, wrong) }
        e.jobs.applyResults()
        val other = e.db.read { coreQueries.selectBackupRecordById("bkp-h2", "h2").executeAsOne() }
        assertEquals("running", other.status)
        assertEquals("ha-1", other.destination_ref)

        val own = e.jobs.enqueue("h1", "backup.generate", """{"recordId":"bkp-h1"}""", null, null)!!
        e.db.write { identityQueries.updateConfigJobStatus("done", now, now, """{"backupId":"ha-x","sizeBytes":10}""", null, null, own) }
        e.jobs.applyResults()
        val mine = e.db.read { coreQueries.selectBackupRecordById("bkp-h1", "h1").executeAsOne() }
        assertEquals("ok", mine.status)
        assertEquals("ha-x", mine.destination_ref)
    }
}
