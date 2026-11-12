package alice.worker

import alice.core.config.ConfigLoaderFactory
import alice.core.di.coreModule
import kotlinx.coroutines.runBlocking
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.slf4j.LoggerFactory
import java.io.File

fun main() {
    val log = LoggerFactory.getLogger("alice.worker")
    val config = ConfigLoaderFactory.load()
    val koin = startKoin { modules(coreModule(config)) }.koin
    val db = koin.get<alice.core.db.Database>()

    val privateKey = System.getenv("CONFIG_WORKER_PRIVATE_KEY")?.trim()?.ifBlank { null }
        ?: System.getenv("CONFIG_WORKER_PRIVATE_KEY_FILE")?.let { path -> runCatching { File(path).readText() }.getOrNull() }
    val workerName = System.getenv("CONFIG_WORKER_NAME")?.ifBlank { null } ?: "config-worker"

    val worker = ConfigWorker(db = db, privateKeyB64 = privateKey, name = workerName)

    Runtime.getRuntime().addShutdownHook(Thread {
        log.info("stopping alice worker")
        worker.stop()
        db.close()
        stopKoin()
    })

    log.info("alice config-worker started against {} (name={}, keyConfigured={})", config.database.path, workerName, privateKey != null)
    runBlocking {
        worker.runLoop(intervalMs = (System.getenv("CONFIG_WORKER_INTERVAL_MS")?.toLongOrNull() ?: 1000L).coerceAtLeast(250))
    }
}
