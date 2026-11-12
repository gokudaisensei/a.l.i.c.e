package alice.core.concurrent

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CancellationTest {
    @Test
    fun `ordinary failures are captured and values returned`() {
        assertEquals(3, runCatchingNonCancellation { 1 + 2 }.getOrNull())
        assertTrue(runCatchingNonCancellation { error("boom") }.isFailure)
    }

    @Test
    fun `cancellation is passed on instead of being swallowed`() {
        assertFailsWith<CancellationException> { runCatchingNonCancellation { throw CancellationException("stop") } }
    }

    @Test
    fun `a cancelled coroutine stops at once, where plain runCatching lets it carry on`() = runBlocking {
        suspend fun work(ran: AtomicBoolean, safe: Boolean) {
            if (safe) runCatchingNonCancellation { delay(60_000) } else runCatching { delay(60_000) }
            ran.set(true) // reached only if cancellation was swallowed
        }
        val safeRan = AtomicBoolean(); val plainRan = AtomicBoolean()
        val safe = launch(Dispatchers.Default) { work(safeRan, safe = true) }
        val plain = launch(Dispatchers.Default) { work(plainRan, safe = false) }
        delay(100)
        safe.cancel(); plain.cancel()
        withTimeout(2000) { safe.join(); plain.join() }
        assertFalse(safeRan.get(), "cancelled work must not continue")
        assertTrue(plainRan.get(), "this is the behaviour the helper exists to avoid")
    }

    @Test
    fun `an expired timeout inside the block is a failure, not a cancellation`() = runBlocking<Unit> {
        val result = runCatchingNonCancellation { kotlinx.coroutines.withTimeout(20) { delay(10_000) } }
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is kotlinx.coroutines.TimeoutCancellationException)
    }

    @Test
    fun `a real cancellation is still passed on even when a timeout is also in play`() = runBlocking<Unit> {
        val reached = AtomicBoolean()
        val job = launch(Dispatchers.Default) {
            runCatchingNonCancellation { kotlinx.coroutines.withTimeout(60_000) { delay(60_000) } }
            reached.set(true)
        }
        delay(100); job.cancel(); withTimeout(2000) { job.join() }
        assertFalse(reached.get(), "cancelling the coroutine must still stop it")
    }
}
