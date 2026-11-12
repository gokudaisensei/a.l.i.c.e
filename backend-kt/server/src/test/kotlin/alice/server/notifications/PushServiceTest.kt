package alice.server.notifications

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.server.notifications.push.PushKeys
import alice.server.notifications.push.PushPayload
import alice.server.notifications.push.PushProvider
import alice.server.notifications.push.PushResult
import alice.server.notifications.push.PushSubscription
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

private class FakeProvider(override val platform: String, override val publicKey: String? = null) : PushProvider {
    var result: PushResult = PushResult.sent
    val sent = mutableListOf<Pair<PushSubscription, PushPayload>>()
    override suspend fun send(sub: PushSubscription, payload: PushPayload): PushResult {
        sent += sub to payload
        return result
    }
}

class PushServiceTest {
    private fun db(): Database {
        val d = Database(DatabaseFactory.open(":memory:"))
        d.write { identityQueries.insertUser("u1", "Test", 1000) }
        return d
    }

    @Test
    fun `register webpush validates endpoint allowlist and stores subscription`() {
        val d = db()
        val svc = PushService(d, listOf(FakeProvider("webpush", "pub")), SystemTimeProvider)
        val sub = svc.registerWebPush(
            "u1",
            "https://fcm.googleapis.com/fcm/send/abc123",
            PushKeys("AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"),
            "Browser",
        )
        assertEquals("webpush", sub.platform)
        assertEquals("Browser", sub.label)
        assertEquals(1, svc.list("u1").size)
        assertThrows<Exception> { svc.registerWebPush("u1", "https://evil.example.com/push", PushKeys("AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB"), null) }
    }

    @Test
    fun `register fcm requires configured provider and valid token`() {
        val d = db()
        val none = PushService(d, emptyList(), SystemTimeProvider)
        assertThrows<Exception> { none.registerFcm("u1", "token-token-token-token-token", null) }
        val svc = PushService(d, listOf(FakeProvider("fcm")), SystemTimeProvider)
        val sub = svc.registerFcm("u1", "token-token-token-token-token", "Phone")
        assertEquals("fcm", sub.platform)
        assertEquals(listOf("fcm"), svc.platforms())
    }

    @Test
    fun `platforms and vapid key reflect configured providers`() {
        val d = db()
        val svc = PushService(d, listOf(FakeProvider("webpush", "VAPIDPUB"), FakeProvider("fcm")), SystemTimeProvider)
        assertTrue(svc.platforms().containsAll(listOf("webpush", "fcm")))
        assertEquals("VAPIDPUB", svc.vapidPublicKey())
    }
}
