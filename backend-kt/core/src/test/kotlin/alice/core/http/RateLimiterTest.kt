package alice.core.http

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.TimeProvider
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RateLimiterTest {
    private fun db(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    @Test
    fun `sqlite store allows exactly limit hits from 20 concurrent threads`() = runBlocking<Unit> {
        val db = db()
        try {
            val limiter = RateLimiter(
                RateLimitOptions(5, 60_000),
                TimeProvider { 1_700_000_000_000L },
                SqliteBucketStore(db),
            )
            repeat(20) { round ->
                val allowed = AtomicInteger()
                val start = CountDownLatch(1)
                val done = CountDownLatch(20)
                val pool = Executors.newFixedThreadPool(20)
                repeat(20) {
                    pool.execute {
                        start.await()
                        try {
                            if (limiter.hit("same-key-$round").allowed) allowed.incrementAndGet()
                        } finally {
                            done.countDown()
                        }
                    }
                }
                start.countDown()
                assertTrue(done.await(10, TimeUnit.SECONDS), "round $round: all threads must finish")
                pool.shutdown()
                assertEquals(5, allowed.get(), "round $round")
            }
        } finally {
            db.close()
        }
    }

    @Test
    fun `the window resets after windowMs and keys are independent`() = runBlocking<Unit> {
        val db = db()
        try {
            var clock = 1_700_000_000_000L
            val limiter = RateLimiter(
                RateLimitOptions(2, 1_000),
                TimeProvider { clock },
                SqliteBucketStore(db),
            )
            assertTrue(limiter.hit("a").allowed)
            assertTrue(limiter.hit("a").allowed)
            assertFalse(limiter.hit("a").allowed)
            assertTrue(limiter.hit("b").allowed)
            assertTrue(limiter.hit("b").allowed)
            assertFalse(limiter.hit("b").allowed)
            clock += 1_001
            assertTrue(limiter.hit("a").allowed)
            limiter.reset("a")
            assertTrue(limiter.hit("a").allowed)
        } finally {
            db.close()
        }
    }
}
