package alice.core.db

import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import org.slf4j.LoggerFactory
import java.io.File
import kotlin.concurrent.withLock

class DatabaseHandle(
    val db: AliceDb,
    val driver: SqlDriver,
) : AutoCloseable {
    override fun close() {
        driver.close()
    }
}

class Database(private val handle: DatabaseHandle) : AutoCloseable {
    val raw: AliceDb get() = handle.db

    private val lock = java.util.concurrent.locks.ReentrantLock()

    fun <T> read(block: AliceDb.() -> T): T = lock.withLock { handle.db.block() }

    fun <T> write(block: AliceDb.() -> T): T = lock.withLock { handle.db.transactionWithResult { handle.db.block() } }

    override fun close() = handle.close()
}

object DatabaseFactory {
    const val MEMORY = ":memory:"
    private val log = LoggerFactory.getLogger(DatabaseFactory::class.java)

    fun open(path: String): DatabaseHandle {
        val inMemory = path.isBlank() || path == MEMORY
        val file = if (inMemory) null else File(path).absoluteFile
        file?.parentFile?.mkdirs()
        val existingEmptyFile = file != null && file.exists() && file.length() == 0L

        val driver = try {
            JdbcSqliteDriver(
                url = if (file == null) JdbcSqliteDriver.IN_MEMORY else "jdbc:sqlite:$file",
            )
        } catch (e: Exception) {
            throw IllegalStateException("The database file $file could not be opened; it was left unchanged: ${e.message}", e)
        }

        // foreign_keys is a connection setting; set it before any schema DDL so creation enforces it too.
        driver.execute(null, "PRAGMA foreign_keys = ON", 0).value

        val existing = try {
            hasTables(driver)
        } catch (e: Exception) {
            driver.close()
            throw IllegalStateException("The database file $file could not be read as a SQLite database; it was left unchanged: ${e.message}", e)
        }

        if (existingEmptyFile && !existing) {
            log.warn("The existing database file {} is empty; initialising a new schema in it", file)
        }

        val current = AliceDb.Schema.version
        if (!existing) {
            AliceDb.Schema.create(driver).value
        } else {
            val stored = userVersion(driver)
            when {
                // Written before the version was tracked reliably; every build stamped it, so treat as current.
                stored == 0L -> Unit
                stored < current -> AliceDb.Schema.migrate(driver, stored, current).value // a failure must stop startup
                stored > current -> {
                    driver.close()
                    error("The database is at schema version $stored but this build only knows $current; refusing to open it")
                }
            }
        }

        applyConstraints(driver)
        driver.execute(null, "PRAGMA busy_timeout = 5000", 0).value
        if (!inMemory) {
            driver.execute(null, "PRAGMA journal_mode = WAL", 0).value
        }

        // Stamped only once creation or migration has succeeded.
        driver.execute(null, "PRAGMA user_version = $current", 0).value

        return DatabaseHandle(db = AliceDb(driver), driver = driver)
    }

    private fun hasTables(driver: SqlDriver): Boolean =
        driver.executeQuery(
            null,
            "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1",
            { cursor -> app.cash.sqldelight.db.QueryResult.Value(cursor.next().value) },
            0,
        ).value

    private fun userVersion(driver: SqlDriver): Long =
        driver.executeQuery(
            null,
            "PRAGMA user_version",
            { cursor -> app.cash.sqldelight.db.QueryResult.Value(if (cursor.next().value) cursor.getLong(0) ?: 0L else 0L) },
            0,
        ).value

    /** Allowed-value triggers (see `constraints.sql`); idempotent, so run on every open, new or old database. */
    private fun applyConstraints(driver: app.cash.sqldelight.db.SqlDriver) {
        val script = DatabaseFactory::class.java.getResourceAsStream("/alice/core/db/constraints.sql")
            ?.bufferedReader()?.readText() ?: error("constraints.sql is missing from the build")
        script.split("\n\n").map { it.trim() }.filter { it.startsWith("CREATE TRIGGER") }.forEach { driver.execute(null, it, 0).value }
    }
}
