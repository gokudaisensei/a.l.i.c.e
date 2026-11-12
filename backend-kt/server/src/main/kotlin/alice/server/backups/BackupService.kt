package alice.server.backups

import alice.core.config.AppConfig
import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.ha.ConfigJobService
import alice.server.notifications.NotificationsService
import alice.server.notifications.NewNotification
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.slf4j.LoggerFactory

private val MAGIC = "ALBK1".toByteArray(Charsets.US_ASCII)
private val PROTECTED_BACKUP_DIRS = listOf(
    "/etc", "/proc", "/sys", "/dev", "/boot", "/bin", "/sbin", "/lib", "/lib64", "/usr", "/root", "/run", "/var/run",
)

@Serializable
data class BackupSettings(
    val enabled: Boolean = true,
    val time: String = "02:30",
    val keep: Int = 14,
    val includeHa: Boolean = true,
    val destination: String = "local",
    val nasPath: String? = null,
    val lastScheduledDay: String? = null,
)

@Serializable data class BackupVerifyView(val status: String, val at: Long? = null, val note: String? = null)
@Serializable
data class BackupView(
    val id: String,
    val kind: String,
    val destination: String,
    val name: String,
    val sizeBytes: Long? = null,
    val encrypted: Boolean,
    val status: String,
    val error: String? = null,
    val trigger: String,
    val createdAt: Long,
    val finishedAt: Long? = null,
    val verify: BackupVerifyView,
    val downloadable: Boolean,
)

@Serializable data class BackupListResponse(val items: List<BackupView>, val settings: BackupSettings, val encryption: Boolean)

class BackupFormatError(msg: String) : RuntimeException(msg)

class BackupService(
    private val db: Database,
    private val jobs: ConfigJobService,
    private val notifications: NotificationsService,
    private val config: AppConfig,
    private val time: TimeProvider,
    private val env: (String) -> String? = System::getenv,
) {
    private val log = LoggerFactory.getLogger(BackupService::class.java)

    /** Beside the database, so it lands on the same volume as the data it protects. */
    private val dir: File = backupDir(config.database.path).apply { mkdirs() }

    // A key that is set but unusable stops startup: silently writing unencrypted backups is worse than not starting.
    private val key: ByteArray? = env("BACKUP_ENCRYPTION_KEY")?.takeIf { it.isNotBlank() }?.let { parseKey(it) }
    private val backupKeys: List<Pair<String, ByteArray>> = parseBackupKeys()
    private val lastAttempt = java.util.concurrent.ConcurrentHashMap<String, Long>()
    @Volatile private var schedulerStarted = false
    @Volatile private var stopScheduler = false

    init {
        jobs.onResult("backup.") { job -> runCatching { onJob(job) } }
    }

    private fun parseBackupKeys(): List<Pair<String, ByteArray>> {
        val raw = env("BACKUP_ENCRYPTION_KEYS") ?: return emptyList()
        // format: id:base64,id2:base64 or just base64 entries
        return raw.split(',').mapNotNull { part ->
            val t = part.trim(); if (t.isEmpty()) return@mapNotNull null
            val idx = t.indexOf(':')
            if (idx > 0) {
                val id = t.substring(0, idx).trim(); val b64 = t.substring(idx + 1).trim()
                runCatching { id to java.util.Base64.getDecoder().decode(b64) }.getOrNull()?.takeIf { it.second.size == 32 }
            } else runCatching { "default" to java.util.Base64.getDecoder().decode(t) }.getOrNull()?.takeIf { it.second.size == 32 }
        }
    }

    fun encryptionEnabled(): Boolean = key != null

    private fun parseKey(b64: String): ByteArray {
        val k = try { Base64.getDecoder().decode(b64.trim()) } catch (_: IllegalArgumentException) { null }
        require(k != null && k.size == 32) { "BACKUP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (generate one with: openssl rand -base64 32)" }
        return k
    }

    private fun now() = time.now()

    fun settings(householdId: String): BackupSettings {
        val row = db.read { identityQueries.selectHouseholdSettings(householdId).executeAsOneOrNull() } ?: return BackupSettings()
        val settingsStr = row.settings ?: return BackupSettings()
        val obj = runCatching { Json.parseToJsonElement(settingsStr).jsonObject["backups"]?.jsonObject }.getOrNull() ?: return BackupSettings()
        fun b(k: String, d: Boolean) = (obj[k] as? JsonPrimitive)?.booleanOrNull ?: d
        fun i(k: String, d: Int) = (obj[k] as? JsonPrimitive)?.intOrNull ?: d
        fun s(k: String, d: String?) = (obj[k] as? JsonPrimitive)?.content ?: d
        return BackupSettings(
            enabled = b("enabled", true),
            time = s("time", "02:30") ?: "02:30",
            keep = i("keep", 14),
            includeHa = b("includeHa", true),
            destination = s("destination", "local") ?: "local",
            nasPath = s("nasPath", null),
            lastScheduledDay = s("lastScheduledDay", null),
        )
    }

    /**
     * Reads the current settings, applies [change] and writes the result in one transaction, so two writers (a user
     * saving the form and the scheduler marking a day done) cannot overwrite each other's fields.
     */
    private fun saveSettings(householdId: String, change: (BackupSettings) -> BackupSettings) {
        db.write {
            val row = identityQueries.selectHouseholdSettings(householdId).executeAsOneOrNull()
            val base = row?.settings?.let { runCatching { Json.parseToJsonElement(it).jsonObject.toMutableMap() }.getOrNull() } ?: mutableMapOf()
            val s = change(settings(householdId))
            base["backups"] = kotlinx.serialization.json.buildJsonObject {
                put("enabled", JsonPrimitive(s.enabled))
                put("time", JsonPrimitive(s.time))
                put("keep", JsonPrimitive(s.keep))
                put("includeHa", JsonPrimitive(s.includeHa))
                put("destination", JsonPrimitive(s.destination))
                put("nasPath", if (s.nasPath == null) kotlinx.serialization.json.JsonNull else JsonPrimitive(s.nasPath))
                put("lastScheduledDay", if (s.lastScheduledDay == null) kotlinx.serialization.json.JsonNull else JsonPrimitive(s.lastScheduledDay))
            }
            identityQueries.updateHouseholdSettingsSettings(kotlinx.serialization.json.JsonObject(base).toString(), householdId)
        }
    }

    /** Resolves a NAS folder once and refuses roots, system locations, the live DB folder, files and unwritable folders. */
    private fun canonicalNasPath(raw: String): File {
        val f = try {
            File(raw).canonicalFile
        } catch (_: Exception) {
            throw AppException("validation_error", "Choose a normal folder path for the NAS share", 400)
        }
        val path = f.toPath().toAbsolutePath().normalize().toString()
        if (f.parentFile == null || path == File.separator) {
            throw AppException("validation_error", "Choose a normal folder path for the NAS share", 400)
        }
        if (PROTECTED_BACKUP_DIRS.any { path == it || path.startsWith("$it/") }) {
            throw AppException("validation_error", "That folder is protected by the system", 400)
        }
        val databasePath = config.database.path
        if (databasePath.isNotBlank() && databasePath != ":memory:") {
            val databaseDir = runCatching { File(databasePath).canonicalFile.parentFile }.getOrNull()
            if (databaseDir != null && f == databaseDir) {
                throw AppException("validation_error", "Choose a folder other than the database's own folder", 400)
            }
        }
        if (!f.exists() || !f.isDirectory) throw AppException("destination_unavailable", "That folder is not available", 400)
        if (!f.canWrite()) throw AppException("destination_unavailable", "That folder is not writable", 400)
        return f
    }

    fun updateSettings(householdId: String, userId: String, patch: Map<String, Any?>): BackupSettings {
        val cur = settings(householdId)
        val s = cur.copy(
            enabled = (patch["enabled"] as? Boolean) ?: cur.enabled,
            time = (patch["time"] as? String) ?: cur.time,
            keep = (patch["keep"] as? Number)?.toInt() ?: cur.keep,
            includeHa = (patch["includeHa"] as? Boolean) ?: cur.includeHa,
            destination = (patch["destination"] as? String) ?: cur.destination,
            nasPath = if (patch.containsKey("nasPath")) (patch["nasPath"] as? String) else cur.nasPath,
        )
        if (!Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(s.time)) throw AppException("validation_error", "Time must look like 02:30", 400)
        if (s.keep !in 1..90) throw AppException("validation_error", "Keep between 1 and 90 backups", 400)
        if (s.destination == "upload") throw AppException("not_implemented", "Uploading backups to a remote store is not available yet", 501)
        val canonicalNas = if (s.destination == "nas") {
            canonicalNasPath(s.nasPath ?: throw AppException("validation_error", "Give the folder of the NAS share", 400)).path
        } else null
        val final = if (s.destination != "nas") s.copy(nasPath = null) else s.copy(nasPath = canonicalNas)
        // The scheduler's marker is not part of the form, so keep whatever it has written since this form was read.
        saveSettings(householdId) { latest -> final.copy(lastScheduledDay = latest.lastScheduledDay) }
        Audit.write(db, "backup.settings", householdId, userId, "user", null, kotlinx.serialization.json.buildJsonObject {
            put("enabled", JsonPrimitive(final.enabled)); put("time", JsonPrimitive(final.time)); put("keep", JsonPrimitive(final.keep)); put("destination", JsonPrimitive(final.destination)); put("includeHa", JsonPrimitive(final.includeHa))
        }, time.now())
        return settings(householdId)
    }

    private fun view(r: alice.core.db.Backup_records): BackupView = BackupView(
        id = r.id, kind = r.kind, destination = r.destination, name = r.name, sizeBytes = r.size_bytes,
        encrypted = r.encrypted == 1L, status = r.status, error = r.error, trigger = r.trigger_kind,
        createdAt = r.created_at, finishedAt = r.finished_at,
        verify = BackupVerifyView(r.verify_status, r.verified_at, r.verify_note),
        downloadable = r.kind == "app" && r.status == "ok",
    )

    fun list(householdId: String): List<BackupView> = db.read { coreQueries.selectBackupRecordsByHousehold(householdId).executeAsList() }.map(::view)

    private fun row(householdId: String, id: String): alice.core.db.Backup_records =
        db.read { coreQueries.selectBackupRecordById(id, householdId).executeAsOneOrNull() } ?: throw notFound("Backup")

    fun get(householdId: String, id: String): BackupView = view(row(householdId, id))

    fun haAvailable(householdId: String): Boolean {
        val st = jobs.status(householdId)
        return st.connected && st.adminTokenSet && st.workerOnline
    }

    private fun destinationDir(householdId: String, destination: String): File {
        return when (destination) {
            "local" -> dir.also { it.mkdirs() }
            "nas" -> {
                val p = settings(householdId).nasPath ?: throw AppException("destination_unavailable", "No NAS folder is set", 400)
                canonicalNasPath(p)
            }
            "upload" -> throw AppException("not_implemented", "Uploading backups to a remote store is not available yet", 501)
            else -> throw AppException("not_implemented", "Destination not available", 501)
        }
    }

    private fun gzip(data: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(data) }
        return bos.toByteArray()
    }
    private fun gunzip(data: ByteArray): ByteArray {
        GZIPInputStream(ByteArrayInputStream(data)).use { return it.readBytes() }
    }

    private fun pack(raw: ByteArray): Pair<ByteArray, Boolean> {
        val gz = gzip(raw)
        val k = key ?: return gz to false
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(k, "AES"), GCMParameterSpec(128, iv))
        val enc = cipher.doFinal(gz) // includes tag at end in JCE
        val tag = enc.copyOfRange(enc.size - 16, enc.size)
        val body = enc.copyOfRange(0, enc.size - 16)
        val out = ByteArray(MAGIC.size + iv.size + tag.size + body.size)
        System.arraycopy(MAGIC, 0, out, 0, MAGIC.size)
        System.arraycopy(iv, 0, out, 5, iv.size)
        System.arraycopy(tag, 0, out, 17, tag.size)
        System.arraycopy(body, 0, out, 33, body.size)
        return out to true
    }

    private fun unpack(bytes: ByteArray): ByteArray {
        try {
            if (bytes.size >= 5 && bytes.copyOfRange(0, 5).contentEquals(MAGIC)) {
                val keys = buildList { key?.let { add(it) }; backupKeys.forEach { add(it.second) } }.distinctBy { it.contentToString() }
                if (keys.isEmpty()) throw BackupFormatError("This backup is encrypted and no backup key is set")
                val iv = bytes.copyOfRange(5, 17)
                val tag = bytes.copyOfRange(17, 33)
                val body = bytes.copyOfRange(33, bytes.size)
                for (k in keys) {
                    try {
                        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(k, "AES"), GCMParameterSpec(128, iv))
                        val gz = cipher.doFinal(body + tag)
                        return gunzip(gz)
                    } catch (_: Throwable) {}
                }
                throw BackupFormatError("The backup is damaged, or the backup key is not the one it was made with")
            }
            return gunzip(bytes)
        } catch (e: BackupFormatError) { throw e }
        catch (_: Throwable) { throw BackupFormatError("The backup is damaged, or the backup key is not the one it was made with") }
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun snapshotDb(): ByteArray {
        val path = config.database.path
        if (path == ":memory:") throw AppException("not_available", "This database lives in memory and cannot be backed up", 409)
        val src = File(path)
        if (!src.exists()) throw AppException("not_available", "Database file not found", 409)
        // VACUUM INTO gives a consistent copy including the write-ahead log. Copying the live file instead would
        // miss recent writes still in the -wal file, so a failure here fails the backup rather than faking one.
        val tmp = File.createTempFile("alice-snap-", ".db").also { it.delete() } // VACUUM INTO needs a path that does not exist
        try {
            try {
                java.sql.DriverManager.getConnection("jdbc:sqlite:${src.absolutePath}").use { c ->
                    // A second connection to a database the app is writing to: wait for the lock instead of failing at once.
                    c.createStatement().use { st -> st.execute("PRAGMA busy_timeout = 10000") }
                    c.createStatement().use { st -> st.execute("VACUUM INTO '${tmp.absolutePath.replace("'", "''")}'") }
                }
            } catch (e: java.sql.SQLException) {
                throw AppException("backup_failed", "Could not take a consistent copy of the database: ${e.message}".take(300), 500)
            }
            return Files.readAllBytes(tmp.toPath())
        } finally { tmp.delete() }
    }

    fun createApp(householdId: String, trigger: String, userId: String?): BackupView {
        val s = settings(householdId)
        val t = now()
        val id = Ids.next("bkp")
        val name = "alice-${Instant.ofEpochMilli(t).toString().replace(Regex("[:.]"), "-")}-${id.takeLast(6).lowercase()}.db${if (key != null) ".enc" else ".gz"}"
        db.write {
            coreQueries.insertBackupRecord(id, householdId, "app", s.destination, null, name, null, null, if (key != null) 1 else 0, null, "running", null, trigger, userId, t, null, "none", null, null)
        }
        try {
            val raw = snapshotDb()
            val (bytes, encrypted) = pack(raw)
            val dest = destinationDir(householdId, s.destination)
            val usable = runCatching { dest.usableSpace }.getOrDefault(Long.MAX_VALUE)
            if (usable != Long.MAX_VALUE && usable < bytes.size.toLong() + 1024 * 1024) {
                throw AppException("destination_unavailable", "Not enough free space for the backup", 400)
            }
            val out = File(dest, name)
            // Write then rename, so a crash never leaves a half-written file under the final name.
            val partial = File(dest, "$name.partial")
            Files.write(partial.toPath(), bytes)
            Files.move(partial.toPath(), out.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
            db.write { coreQueries.updateBackupRecord(name, bytes.size.toLong(), sha256(bytes), if (encrypted) 1 else 0, "ok", null, now(), id) }
            Audit.write(db, "backup.created", householdId, userId, if (userId != null) "user" else "system", id, kotlinx.serialization.json.buildJsonObject { put("kind", JsonPrimitive("app")); put("trigger", JsonPrimitive(trigger)); put("destination", JsonPrimitive(s.destination)) }, time.now())
        } catch (e: Throwable) {
            db.write { coreQueries.updateBackupRecord(null, null, null, if (key != null) 1 else 0, "failed", (e.message ?: "The backup could not be written").take(300), now(), id) }
            runCatching { notifications.notifyAdmins(householdId, NewNotification(kind = "backup_failed", title = "A backup failed", body = (e.message ?: "").take(200), urgent = true)) }
        }
        return get(householdId, id)
    }

    private fun setVerify(id: String, status: String, note: String?) {
        db.write { coreQueries.updateBackupVerify(status, if (status == "running") null else now(), note?.take(300), id) }
    }

    fun verify(householdId: String, id: String): BackupView {
        val r = row(householdId, id)
        if (r.kind == "ha") {
            if (r.status != "ok" || r.destination_ref == null) throw AppException("not_available", "That backup is not finished", 409)
            setVerify(id, "running", null)
            val enq = jobs.enqueue(householdId, "backup.info", kotlinx.serialization.json.buildJsonObject { put("recordId", JsonPrimitive(r.id)); put("backupId", JsonPrimitive(r.destination_ref)) }.toString(), "backup.info:${r.id}")
            if (enq == null) setVerify(id, "failed", "Home Assistant is not connected")
            return get(householdId, id)
        }
        if (r.status != "ok") throw AppException("not_available", "That backup is not finished", 409)
        setVerify(id, "running", null)
        try {
            val bytes = readFile(householdId, r)
            if (r.sha256 != null && sha256(bytes) != r.sha256) throw BackupFormatError("The file does not match the checksum recorded when it was made")
            val raw = unpack(bytes)
            val note = inspectRaw(raw)
            setVerify(id, "passed", note)
        } catch (e: Throwable) {
            setVerify(id, "failed", e.message ?: "Could not be read")
        }
        val after = row(householdId, id)
        if (after.verify_status == "failed") runCatching { notifications.notifyAdmins(householdId, NewNotification(kind = "backup_failed", title = "A backup did not pass its restore test", body = (after.verify_note ?: "").take(200), urgent = true)) }
        return view(after)
    }

    private fun readFile(householdId: String, r: alice.core.db.Backup_records): ByteArray {
        if (r.kind != "app" || r.status != "ok" || r.destination_ref == null) throw AppException("not_available", "That backup has no file to read", 409)
        var f = File(destinationDir(householdId, r.destination), r.destination_ref)
        // Backups made before the folder moved beside the database.
        if (!f.exists() && r.destination == "local") f = File(File(System.getProperty("user.dir"), "data/backups"), r.destination_ref)
        if (!f.exists()) throw AppException("not_available", "The backup file is missing", 409)
        return Files.readAllBytes(f.toPath())
    }

    private fun inspectRaw(raw: ByteArray): String {
        val tmp = File.createTempFile("alice-check-", ".db")
        try {
            Files.write(tmp.toPath(), raw)
            java.sql.DriverManager.getConnection("jdbc:sqlite:${tmp.absolutePath}").use { c ->
                val integrity = c.createStatement().use { st -> st.executeQuery("PRAGMA integrity_check").use { rs -> if (rs.next()) rs.getString(1) else "unknown" } }
                if (integrity != "ok") throw BackupFormatError("The database is damaged ($integrity)")
                val tables = c.createStatement().use { st -> st.executeQuery("select name from sqlite_master where type='table' and name not like 'sqlite_%'").use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() } }
                fun count(t: String): Int = runCatching { c.createStatement().use { st -> st.executeQuery("select count(*) from \"$t\"").use { rs -> if (rs.next()) rs.getInt(1) else 0 } } }.getOrDefault(0)
                val users = count("users"); val households = count("households")
                if (users == 0 || households == 0) throw BackupFormatError("The backup has no users or no household in it")
                val schema = runCatching { c.createStatement().use { st -> st.executeQuery("PRAGMA user_version").use { rs -> if (rs.next()) rs.getInt(1) else null } } }.getOrNull()
                if (schema != null && schema > alice.core.db.AliceDb.Schema.version) {
                    throw BackupFormatError("The backup is from a newer version of Alice (schema $schema, this build knows ${alice.core.db.AliceDb.Schema.version})")
                }
                val required = listOf("users", "households", "sessions")
                val missing = required.filter { it !in tables }
                if (missing.isNotEmpty()) throw BackupFormatError("Missing tables: ${missing.joinToString(", ")}")
                return "Opened cleanly: ${users} user(s), ${households} household(s), ${tables.size} tables${schema?.let { ", schema $it" } ?: ""}"
            }
        } finally { tmp.delete() }
    }

    fun download(householdId: String, id: String, userId: String): Pair<String, ByteArray> {
        val r = row(householdId, id)
        if (r.kind != "app" || r.status != "ok" || r.destination_ref == null) throw AppException("not_available", "Only Alice's own finished backups can be downloaded", 409)
        val bytes = readFile(householdId, r)
        Audit.write(db, "backup.downloaded", householdId, userId, "user", id, null, time.now())
        return r.name to bytes
    }

    fun stageRestore(householdId: String, id: String, userId: String): Map<String, Any?> {
        val dbPath = config.database.path
        if (dbPath == ":memory:") throw AppException("not_available", "This database lives in memory and cannot be restored", 409)
        val r = row(householdId, id)
        val bytes = readFile(householdId, r)
        if (r.sha256 != null && sha256(bytes) != r.sha256) throw BackupFormatError("The file does not match the checksum recorded when it was made")
        val raw = unpack(bytes)
        inspectRaw(raw)
        val pending = File(RestoreApply.pendingRestorePath(dbPath))
        // Written under another name and renamed, so a crash cannot leave a half-written file where the restart looks.
        val partial = File("${pending.path}.partial")
        Files.write(partial.toPath(), raw)
        Files.move(partial.toPath(), pending.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
        Audit.write(db, "backup.restore_staged", householdId, userId, "user", id, null, time.now())
        return mapOf("staged" to true, "applyOnRestart" to true, "note" to "Restart Alice to finish. Your current database is kept next to it until you remove it.")
    }

    fun createHa(householdId: String, trigger: String, userId: String?): BackupView {
        val id = Ids.next("bkp")
        val t = now()
        val name = "Alice ${DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("UTC")).format(Instant.ofEpochMilli(t))}"
        if (jobs.connectionIdFor(householdId) == null) throw AppException("ha_not_connected", "Connect Home Assistant first", 409)
        db.write { coreQueries.insertBackupRecord(id, householdId, "ha", "ha", null, name, null, null, 0, null, "running", null, trigger, userId, t, null, "none", null, null) }
        jobs.enqueue(householdId, "backup.generate", kotlinx.serialization.json.buildJsonObject { put("recordId", JsonPrimitive(id)); put("name", JsonPrimitive(name)) }.toString())
        return get(householdId, id)
    }

    fun restoreHa(householdId: String, id: String, userId: String): Map<String, Any?> {
        val r = row(householdId, id)
        if (r.kind != "ha" || r.status != "ok" || r.destination_ref == null) throw AppException("not_available", "That is not a finished Home Assistant backup", 409)
        val job = jobs.enqueue(householdId, "backup.restore", kotlinx.serialization.json.buildJsonObject { put("recordId", JsonPrimitive(id)); put("backupId", JsonPrimitive(r.destination_ref)) }.toString(), requestedBy = userId)
            ?: throw AppException("ha_not_connected", "Connect Home Assistant first", 409)
        Audit.write(db, "backup.ha_restore_requested", householdId, userId, "user", id, null, time.now())
        return mapOf("queued" to true, "jobId" to job, "note" to "Home Assistant will restart while it restores. Alice reconnects by itself.")
    }

    fun remove(householdId: String, id: String, userId: String): Map<String, Any?> {
        val r = row(householdId, id)
        Audit.write(db, "backup.deleted", householdId, userId, "user", id, kotlinx.serialization.json.buildJsonObject { put("kind", JsonPrimitive(r.kind)) }, time.now())
        if (r.kind == "ha" && r.status == "ok" && r.destination_ref != null) {
            val enq = jobs.enqueue(householdId, "backup.delete", kotlinx.serialization.json.buildJsonObject { put("recordId", JsonPrimitive(id)); put("backupId", JsonPrimitive(r.destination_ref)) }.toString(), requestedBy = userId)
                ?: throw AppException("ha_not_connected", "Connect Home Assistant first", 409)
            return mapOf("removed" to false, "pending" to true)
        }
        if (r.kind == "app" && r.destination_ref != null) {
            runCatching { File(destinationDir(householdId, r.destination), r.destination_ref).delete() }
        }
        db.write { coreQueries.deleteBackupRecordById(id) }
        return mapOf("removed" to true)
    }

    fun summary(householdId: String): Map<String, Any?> {
        val ok = list(householdId).firstOrNull { it.kind == "app" && it.status == "ok" }
        return mapOf("lastOkAt" to ok?.finishedAt, "lastVerifyStatus" to ok?.verify?.status, "failedVerify" to (ok?.verify?.status == "failed"), "enabled" to settings(householdId).enabled)
    }


    private fun onJob(job: alice.ha.ConfigJob) {
        val payload = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(job.payload).jsonObject }.getOrNull() ?: return
        val recordId = payload["recordId"]?.jsonPrimitive?.content ?: return
        val jobHousehold = db.read { identityQueries.selectConfigJobById(job.id).executeAsOneOrNull()?.household_id } ?: return
        val rec = findRecordById(recordId) ?: return
        if (rec.household_id != jobHousehold) {
            log.warn("ignoring backup job {} for record {} from another household", job.id, recordId)
            return
        }
        if (job.operation == "backup.generate") {
            if (job.status == "done") {
                val result = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(job.result ?: "{}").jsonObject }.getOrNull()
                val backupId = result?.get("backupId")?.jsonPrimitive?.content
                val size = result?.get("sizeBytes")?.jsonPrimitive?.content?.toLongOrNull()
                db.write { coreQueries.updateBackupRecord(backupId, size, null, 0, "ok", null, now(), rec.id) }
                Audit.write(db, "backup.created", rec.household_id, rec.created_by, if (rec.created_by != null) "user" else "system", rec.id, kotlinx.serialization.json.buildJsonObject { put("kind", JsonPrimitive("ha")); put("trigger", JsonPrimitive(rec.trigger_kind)) }, now())
                if (backupId != null) jobs.enqueue(rec.household_id, "backup.info", kotlinx.serialization.json.buildJsonObject { put("recordId", JsonPrimitive(rec.id)); put("backupId", JsonPrimitive(backupId)) }.toString(), "backup.info:${rec.id}")
                setVerify(rec.id, "running", null)
                retain(rec.household_id, "ha")
            } else {
                db.write { coreQueries.updateBackupRecord(rec.destination_ref, rec.size_bytes, rec.sha256, rec.encrypted, "failed", ("Home Assistant could not make the backup: ${job.error ?: "unknown error"}").take(300), now(), rec.id) }
                runCatching { notifications.notifyAdmins(rec.household_id, NewNotification(kind = "backup_failed", title = "A backup failed", body = (job.error ?: "").take(200), urgent = true)) }
            }
        } else if (job.operation == "backup.info") {
            if (job.status != "done") {
                setVerify(rec.id, "failed", ("Could not ask Home Assistant: ${job.error ?: "unknown error"}").take(300))
            } else {
                val x = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(job.result ?: "{}").jsonObject }.getOrNull()
                val exists = x?.get("exists")?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: true
                val sizeBytes = x?.get("sizeBytes")?.jsonPrimitive?.content?.toLongOrNull()
                val homeIncluded = x?.get("homeassistantIncluded")?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: true
                val dbIncluded = x?.get("databaseIncluded")?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
                val problems = mutableListOf<String>()
                if (!exists) problems += "Home Assistant no longer has this backup"
                else {
                    if (sizeBytes != null && sizeBytes <= 0) problems += "it is empty"
                    if (!homeIncluded) problems += "it does not include the Home Assistant configuration"
                }
                setVerify(rec.id, if (problems.isEmpty()) "passed" else "failed", if (problems.isEmpty()) "Home Assistant lists it${sizeBytes?.let { ": $it bytes" } ?: ""}, configuration${if (dbIncluded) " and history" else ""} included" else problems.joinToString("; "))
                if (problems.isNotEmpty()) runCatching { notifications.notifyAdmins(rec.household_id, NewNotification(kind = "backup_failed", title = "A Home Assistant backup did not pass its check", body = problems.joinToString("; ").take(200), urgent = true)) }
            }
        } else if (job.operation == "backup.delete") {
            if (job.status == "done") db.write { coreQueries.deleteBackupRecordById(rec.id) }
            else db.write { coreQueries.updateBackupRecord(rec.destination_ref, rec.size_bytes, rec.sha256, rec.encrypted, rec.status, ("Could not delete from Home Assistant: ${job.error ?: "unknown error"}").take(300), rec.finished_at, rec.id) }
        } else if (job.operation == "backup.restore") {
            Audit.write(db, if (job.status == "done") "backup.ha_restore_done" else "backup.ha_restore_failed", rec.household_id, null, "system", rec.id, if (job.status == "done") null else kotlinx.serialization.json.buildJsonObject { put("error", JsonPrimitive(job.error ?: "")) }, now())
            if (job.status != "done") runCatching { notifications.notifyAdmins(rec.household_id, NewNotification(kind = "backup_failed", title = "The Home Assistant restore failed", body = (job.error ?: "").take(200), urgent = true)) }
        }
    }

    private fun findRecordById(id: String): alice.core.db.Backup_records? =
        db.read { coreQueries.selectBackupRecordByIdOnly(id).executeAsOneOrNull() }

    private fun retain(householdId: String, kind: String) {
        val keep = settings(householdId).keep
        val rows = db.read { coreQueries.selectBackupRecordsByHousehold(householdId).executeAsList() }
            .filter { it.kind == kind && it.status != "running" }
            .sortedWith(compareByDescending<alice.core.db.Backup_records> { it.created_at }.thenByDescending { it.id })
        for (r in rows.drop(keep)) runCatching { remove(householdId, r.id, "system") }
    }

    /** Backups that were being written when the process stopped will never finish; say so instead of showing "running" forever. */
    fun recoverInterrupted(): Int {
        val stuck = db.read { coreQueries.selectRunningAppBackups().executeAsList() }
        for (r in stuck) {
            db.write { coreQueries.updateBackupRecord(null, null, null, r.encrypted, "failed", "The server stopped before this backup finished", now(), r.id) }
        }
        runCatching { dir.listFiles { f -> f.name.endsWith(".partial") }?.forEach { it.delete() } }
        return stuck.size
    }

    fun startScheduler() {
        if (schedulerStarted) return
        schedulerStarted = true
        runCatching { recoverInterrupted() }
        Thread {
            while (!stopScheduler) {
                runCatching { tick() }
                try { Thread.sleep(60_000) } catch (_: InterruptedException) { break }
            }
        }.apply { isDaemon = true; name = "alice-backup-scheduler" }.start()
    }

    fun stopScheduler() { stopScheduler = true }

    fun tick() {
        val households = db.read { identityQueries.selectAllHouseholds().executeAsList() }
        for (h in households) {
            val s = settings(h.id)
            if (!s.enabled) continue
            val tz = h.timezone
            val zone = runCatching { java.time.ZoneId.of(tz) }.getOrDefault(java.time.ZoneId.of("UTC"))
            val zdt = java.time.Instant.ofEpochMilli(now()).atZone(zone)
            val day = zdt.toLocalDate().toString()
            val minutes = zdt.hour * 60 + zdt.minute
            val parts = s.time.split(":")
            val hh = parts.getOrNull(0)?.toIntOrNull() ?: 2
            val mm = parts.getOrNull(1)?.toIntOrNull() ?: 30
            if (s.lastScheduledDay == day || minutes < hh * 60 + mm) continue
            // After a failure, wait before trying again rather than retrying every minute or giving up for the day.
            val lastTry = lastAttempt[h.id]
            if (lastTry != null && now() - lastTry < RETRY_AFTER_FAILURE_MS) continue
            lastAttempt[h.id] = now()
            val rec = createApp(h.id, "scheduled", null)
            if (rec.status == "ok") {
                // The day counts as done only once a backup exists.
                saveSettings(h.id) { it.copy(lastScheduledDay = day) }
                lastAttempt.remove(h.id)
                runCatching { verify(h.id, rec.id) }
                retain(h.id, "app")
            }
            if (s.includeHa && haAvailable(h.id)) runCatching { createHa(h.id, "scheduled", null) }
        }
    }

}

private const val RETRY_AFTER_FAILURE_MS = 60 * 60_000L

internal fun backupDir(databasePath: String): File =
    if (databasePath.isBlank() || databasePath == ":memory:") File(System.getProperty("user.dir"), "data/backups")
    else File(File(databasePath).absoluteFile.parentFile, "backups")
