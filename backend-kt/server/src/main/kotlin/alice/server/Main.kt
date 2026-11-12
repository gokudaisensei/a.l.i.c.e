package alice.server

import alice.core.config.ConfigLoaderFactory
import alice.core.db.Database
import alice.core.di.coreModule
import alice.server.auth.AuthService
import alice.server.di.serverModule
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.slf4j.LoggerFactory

fun main() {
    val log = LoggerFactory.getLogger("alice.server")

    val config = ConfigLoaderFactory.load()
    if (config.database.path != ":memory:") {
        val (applied, detail) = alice.server.backups.RestoreApply.applyPendingRestore(config.database.path)
        if (applied) log.warn("applied a staged backup restore: {}", detail)
        else if (detail != "nothing staged") log.error("staged backup restore was not applied: {}", detail)
    }
    val koin = startKoin {
        modules(coreModule(config), serverModule())
    }.koin

    val database = koin.get<Database>()
    val auth = koin.get<AuthService>()

    // A production install must not let the first visitor become admin: without
    // a configured setup code, generate one and print it once to stderr (not the
    // logging framework, whose appenders may ship it elsewhere).
    val generatedSetupCode = announceSetupCode(
        environment = config.app.environment,
        hasSetupCode = auth.setupCode != null,
        needsSetup = auth.needsSetup(),
    ) { System.err.println(it) }
    if (generatedSetupCode != null) auth.setupCode = generatedSetupCode

    val configJobs = koin.get<alice.ha.ConfigJobService>()
    val lifecycle = BackgroundServices()
    serverBackgroundServices(koin, lifecycle)
    val failed = lifecycle.startAll()
    log.info(
        "started {} of {} background services{}",
        lifecycle.count - failed.size,
        lifecycle.count,
        if (failed.isEmpty()) "" else "; failed: ${failed.joinToString(",")}",
    )

    val realtime = koin.get<alice.server.realtime.RealtimeHub>()
    val server = embeddedServer(CIO, host = config.server.host, port = config.server.port) {
        configure(koin)
    }

    Runtime.getRuntime().addShutdownHook(
        Thread {
            log.info("stopping alice server")
            runCatching { lifecycle.stopAll() }.onFailure { log.warn("failed to stop background services", it) }
            runCatching { configJobs.applyResults() }
            runCatching { configJobs.prune(7) }
            realtime.closeAll("Server shutting down")
            server.stop(gracePeriodMillis = 1_000, timeoutMillis = 5_000)
            database.close()
            stopKoin()
        },
    )

    log.info("alice {} listening on {}:{}", config.app.version, config.server.host, config.server.port)
    server.start(wait = true)
}
