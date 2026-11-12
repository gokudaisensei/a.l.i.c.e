package alice.server.backups

import alice.core.db.AliceDb
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.sql.DriverManager

/** Applies a backup that was staged next to the database, at the next start and before the database is opened. */
object RestoreApply {
    fun pendingRestorePath(dbPath: String): String = "$dbPath.restore-pending"

    private fun moveFile(from: Path, to: Path) { Files.move(from, to, StandardCopyOption.REPLACE_EXISTING) }

    /**
     * Why [file] must not replace the live database, or null when it is fit to. Checked again here, not only when the
     * backup was staged, because the file can change between staging and the restart.
     */
    fun restoreProblem(file: File): String? = try {
        DriverManager.getConnection("jdbc:sqlite:${file.absolutePath}").use { c ->
            fun scalar(sql: String): String? = c.createStatement().use { st -> st.executeQuery(sql).use { rs -> if (rs.next()) rs.getString(1) else null } }
            val integrity = scalar("PRAGMA integrity_check")
            when {
                integrity != "ok" -> "it is damaged ($integrity)"
                (scalar("PRAGMA user_version")?.toLongOrNull() ?: 0L) > AliceDb.Schema.version ->
                    "it is from a newer version of Alice (schema ${scalar("PRAGMA user_version")}, this build knows ${AliceDb.Schema.version})"
                listOf("users", "households", "sessions").any { t -> scalar("select name from sqlite_master where type='table' and name='$t'") == null } ->
                    "it is missing tables Alice needs"
                (scalar("select count(*) from users")?.toLongOrNull() ?: 0L) == 0L || (scalar("select count(*) from households")?.toLongOrNull() ?: 0L) == 0L ->
                    "it holds no users or no household"
                else -> null
            }
        }
    } catch (e: Throwable) { "it could not be read (${e.message})" }

    /**
     * Swaps the staged file in. The current database (with its write-ahead log, which can hold recent changes) is moved
     * aside as a whole first; if anything fails after that, every file is moved back, so a failure never leaves the
     * install without a database.
     */
    fun applyPendingRestore(
        dbPath: String,
        now: Long = System.currentTimeMillis(),
        move: (Path, Path) -> Unit = ::moveFile,
    ): Pair<Boolean, String> {
        if (dbPath == ":memory:") return false to "nothing staged"
        val pending = File(pendingRestorePath(dbPath))
        if (!pending.exists()) return false to "nothing staged"
        val problem = restoreProblem(pending)
        if (problem != null) {
            runCatching { moveFile(pending.toPath(), File("${pending.absolutePath}.rejected-$now").toPath()) }
            return false to "the staged restore was set aside: $problem"
        }
        val moved = mutableListOf<Pair<File, File>>()
        try {
            for (suffix in listOf("", "-wal", "-shm")) {
                val live = File(dbPath + suffix)
                if (!live.exists()) continue
                val aside = File("$dbPath.before-restore-$now$suffix")
                move(live.toPath(), aside.toPath())
                moved += live to aside
            }
            move(pending.toPath(), File(dbPath).toPath())
        } catch (e: Throwable) {
            for ((live, aside) in moved.asReversed()) runCatching { move(aside.toPath(), live.toPath()) }
            return false to "the restore failed (${e.message}); the previous database was put back"
        }
        return true to "restored; the previous database is kept at $dbPath.before-restore-$now"
    }
}
