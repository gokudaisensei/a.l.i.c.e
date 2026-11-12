package alice.server.boot

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.di.coreModule
import alice.server.BackgroundServices
import alice.server.serverBackgroundServices
import alice.server.di.serverModule
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class LifecycleTest {
    @Test
    fun `one failing start is reported by name and the rest start`() = runBlocking<Unit> {
        repeat(20) {
            val services = BackgroundServices()
            val started = mutableListOf<String>()
            services.component("a", start = { started += "a" })
            services.component("b", start = { error("boom") })
            services.component("c", start = { started += "c" })
            val failed = services.startAll()
            assertEquals(listOf("b"), failed)
            assertEquals(listOf("a", "c"), started)
            services.stopAll()
        }
    }

    @Test
    fun `stopAll is reverse, only started, tolerates a bad stop and is idempotent`() = runBlocking<Unit> {
        repeat(20) {
            val services = BackgroundServices()
            val stopped = mutableListOf<String>()
            services.component("a", start = { }, stop = { stopped += "a" })
            services.component("b", start = { error("no") }, stop = { stopped += "b" })
            services.component("c", start = { }, stop = { error("stop failed") })
            services.component("d", start = { }, stop = { stopped += "d" })
            assertEquals(listOf("b"), services.startAll())
            services.stopAll()
            assertEquals(listOf("d", "a"), stopped)
            services.stopAll()
            assertEquals(listOf("d", "a"), stopped)
        }
    }

    @Test
    fun `a looping job ends promptly when the services stop`() = runBlocking<Unit> {
        repeat(20) {
            val services = BackgroundServices()
            var ticks = 0
            services.loop("loop", initialDelayMs = 0, intervalMs = 5) { ticks++ }
            services.startAll()
            withTimeout(1_000) { while (ticks < 3) delay(5) }
            services.stopAll()
            val afterStop = ticks
            delay(100)
            assertEquals(afterStop, ticks)
        }
    }

    @Test
    fun `cancellation from a component start propagates`() = runBlocking<Unit> {
        repeat(20) {
            val services = BackgroundServices()
            var laterStarted = false
            services.component("cancelled", start = { throw CancellationException("stop now") })
            services.component("later", start = { laterStarted = true })
            assertFailsWith<CancellationException> { services.startAll() }
            assertTrue(!laterStarted)
            services.stopAll()
        }
    }

    @Test
    fun `the real component list starts and stops cleanly`() = runBlocking<Unit> {
        val app = koinApplication {
            modules(coreModule(AppConfig(database = DatabaseConfig(path = ":memory:"))), serverModule())
        }
        try {
            val services = BackgroundServices()
            serverBackgroundServices(app.koin, services)
            val failed = services.startAll()
            assertTrue(failed.isEmpty(), "failed: $failed")
            services.stopAll()
        } finally {
            app.close()
        }
    }

    @Test
    fun `a loop whose work times out keeps looping and still stops on stopAll`() = runBlocking<Unit> {
        val services = BackgroundServices()
        val runs = java.util.concurrent.atomic.AtomicInteger()
        services.loop("timing-out", initialDelayMs = 0, intervalMs = 20) {
            runs.incrementAndGet()
            withTimeout(5) { delay(10_000) } // every run times out
        }
        assertTrue(services.startAll().isEmpty())
        withTimeout(3000) { while (runs.get() < 3) delay(10) }
        services.stopAll()
        val after = runs.get()
        delay(150)
        assertTrue(runs.get() <= after + 1, "the loop must end after stopAll")
    }
}
