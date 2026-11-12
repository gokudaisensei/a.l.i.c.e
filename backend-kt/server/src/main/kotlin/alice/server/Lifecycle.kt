package alice.server

import alice.core.security.Tokens
import alice.server.backups.BackupService
import alice.server.commands.CommandExecutor
import alice.server.ha.HaRuntime
import alice.server.maintenance.HousekeepingScheduler
import alice.server.maintenance.Retention
import alice.server.routines.RoutinesService
import alice.server.sync.ConfigSyncService
import alice.server.sync.HaEventBridge
import alice.server.updates.UpdateService
import alice.ha.ConfigJobService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import org.koin.core.Koin
import org.slf4j.Logger
import org.slf4j.LoggerFactory

/**
 * Owns the server's background work so boot and shutdown are explicit: each component has a name, a start and a
 * stop, failures are reported instead of discarded, and one scope ends every coroutine loop on shutdown.
 */
class BackgroundServices(
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val log: Logger = LoggerFactory.getLogger(BackgroundServices::class.java),
) {
    data class Component(val name: String, val start: () -> Unit, val stop: () -> Unit = { })

    private val lock = Any()
    private val components = mutableListOf<Component>()
    private val started = mutableListOf<Component>()
    private var stopped = false

    val count: Int get() = synchronized(lock) { components.size }

    fun component(name: String, start: () -> Unit, stop: () -> Unit = { }): Component =
        Component(name, start, stop).also { synchronized(lock) { components += it } }

    /** A named coroutine loop in the shared scope. The first run waits [initialDelayMs]; every run is followed by [intervalMs]. */
    fun loop(
        name: String,
        initialDelayMs: Long,
        intervalMs: Long,
        block: suspend () -> Unit,
    ): Component {
        var job: Job? = null
        return component(
            name = name,
            start = {
                job = scope.launch {
                    if (initialDelayMs > 0) delay(initialDelayMs)
                    while (isActive) {
                        try {
                            block()
                        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
                            log.error("background loop {} timed out", name, e) // a timeout inside the work, not a stop request
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            log.error("background loop {} failed", name, e)
                        }
                        delay(intervalMs)
                    }
                }
            },
            stop = {
                job?.cancel()
                job = null
            },
        )
    }

    /** Starts everything, reports failures by name, and never lets one bad component stop the rest. */
    fun startAll(): List<String> {
        val failed = mutableListOf<String>()
        for (component in synchronized(lock) { components.toList() }) {
            try {
                component.start()
                synchronized(lock) { started += component }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                log.error("background service {} failed to start", component.name, e)
                failed += component.name
            }
        }
        return failed
    }

    /** Stops only what started, in reverse order, tolerates failures and is safe to call twice. */
    fun stopAll() {
        val toStop = synchronized(lock) {
            if (stopped) return
            stopped = true
            started.toList().also { started.clear() }.asReversed()
        }
        for (component in toStop) {
            try {
                component.stop()
            } catch (e: Exception) {
                log.warn("background service {} failed to stop: {}", component.name, e.message)
            }
        }
        scope.cancel()
    }
}

/** Registers the real server background components. Main and the lifecycle integration test both call this. */
fun serverBackgroundServices(koin: Koin, services: BackgroundServices) {
    val routines = koin.get<RoutinesService>()
    val executor = koin.get<CommandExecutor>()
    val runtime = koin.get<HaRuntime>()
    val bridge = koin.get<HaEventBridge>()
    val configJobs = koin.get<ConfigJobService>()
    val retention = koin.get<Retention>()
    val housekeeping = koin.get<HousekeepingScheduler>()
    val backups = koin.get<BackupService>()
    val updates = koin.get<UpdateService>()
    val configSync = koin.get<ConfigSyncService>()

    services.component("routine-recovery", start = { routines.resumeInterrupted() }, stop = { routines.stop() })
    services.component("command-recovery", start = { executor.recoverInterrupted() })
    services.component("ha-runtime", start = { runtime.start() }, stop = { runtime.close() })
    services.component("ha-event-bridge", start = { bridge.start() }, stop = { bridge.stop() })
    services.component("config-job-scheduler", start = { configJobs.startScheduler() }, stop = { configJobs.stopScheduler() })
    services.component("retention", start = { retention.start() }, stop = { retention.stop() })
    services.component("housekeeping", start = { housekeeping.start() }, stop = { housekeeping.stop() })
    services.component("backup-scheduler", start = { backups.startScheduler() }, stop = { backups.stopScheduler() })
    services.loop("update-check", initialDelayMs = 0, intervalMs = 60_000) { updates.tick() }
    services.loop("config-verify", initialDelayMs = 60_000, intervalMs = 15 * 60_000) {
        runInterruptible(Dispatchers.IO) { configSync.verifyAll() }
    }
}

/**
 * Generates and announces the first-run setup code in production when there is no code and no user yet.
 * The operator sees it on stderr, not through logging. Returns the generated code, or null when nothing was written.
 */
fun announceSetupCode(
    environment: String,
    hasSetupCode: Boolean,
    needsSetup: Boolean,
    generate: () -> String = { Tokens.randomToken(9) },
    write: (String) -> Unit,
): String? {
    if (environment != "production" || hasSetupCode || !needsSetup) return null
    val code = generate()
    write("this install has no users yet: the first person to register needs this setup code: $code")
    return code
}
