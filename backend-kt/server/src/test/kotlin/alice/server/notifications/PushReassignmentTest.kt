package alice.server.notifications

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.server.notifications.push.PushKeys
import alice.server.notifications.push.PushPayload
import alice.server.notifications.push.PushProvider
import alice.server.notifications.push.PushResult
import alice.server.notifications.push.PushSubscription
import kotlinx.coroutines.runBlocking
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private class FakeFcm : PushProvider {
    override val platform = "fcm"
    override var publicKey: String? = null
    val sent = mutableListOf<PushSubscription>()
    override suspend fun send(sub: PushSubscription, payload: PushPayload): PushResult {
        sent += sub
        return PushResult.sent
    }
}

class PushReassignmentTest {
    private fun db(): Database {
        val d = Database(DatabaseFactory.open(":memory:"))
        d.write {
            identityQueries.insertUser("u1", "One", 1)
            identityQueries.insertUser("u2", "Two", 1)
        }
        return d
    }

    @Test
    fun `the last user to register a device token owns it`() = runBlocking<Unit> {
        val d = db()
        val provider = FakeFcm()
        val svc = PushService(d, listOf(provider), SystemTimeProvider)
        val token = "device-token-1234567890"
        svc.registerFcm("u1", token, "Phone")
        svc.registerFcm("u2", token, "Phone")
        assertTrue(svc.list("u1").isEmpty())
        assertEquals(1, svc.list("u2").size)
        assertEquals("none", svc.deliver("n1", "h1", "u1", "test", "T", "B", false))
        assertTrue(provider.sent.none { it.userId == "u1" })
        svc.registerFcm("u2", token, "Phone again")
        assertEquals(1, svc.list("u2").size)
        assertEquals(1L, d.read { coreQueries.selectAuditLogByAction("push.device_reassigned").executeAsList().size.toLong() })
    }

    @Test
    fun `the subscription limit holds under concurrent registrations`() = runBlocking<Unit> {
        val d = db()
        val svc = PushService(d, listOf(FakeFcm()), SystemTimeProvider)
        repeat(20) { round ->
            val user = "concurrent-$round"
            d.write { identityQueries.insertUser(user, user, 1) }
            val start = CountDownLatch(1)
            val done = CountDownLatch(20)
            val pool = Executors.newFixedThreadPool(20)
            repeat(20) { i ->
                pool.execute {
                    start.await()
                    try {
                        runCatching { svc.registerFcm(user, "token-$round-$i-abcdefghij", "Phone $i") }
                    } finally {
                        done.countDown()
                    }
                }
            }
            start.countDown()
            assertTrue(done.await(10, TimeUnit.SECONDS), "round $round did not finish")
            pool.shutdown()
            assertTrue(svc.list(user).size <= PushService.MAX_SUBSCRIPTIONS_PER_USER, "round $round size ${svc.list(user).size}")
        }
    }
}
