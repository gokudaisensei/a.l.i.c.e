package alice.server.notifications

import alice.server.notifications.push.PushResult
import alice.server.notifications.push.fcmFailure
import alice.server.notifications.push.webPushFailure
import alice.server.notifications.push.webPushResult
import com.interaso.webpush.WebPush
import com.interaso.webpush.WebPushStatusException
import kotlin.test.Test
import kotlin.test.assertEquals

class PushResultMappingTest {
    @Test
    fun `an expired web push subscription is dropped and an active one counts as sent`() {
        assertEquals(PushResult.sent, webPushResult(WebPush.SubscriptionState.ACTIVE))
        assertEquals(PushResult.gone, webPushResult(WebPush.SubscriptionState.EXPIRED))
    }

    @Test
    fun `only 404 and 410 remove a web push subscription`() {
        assertEquals(PushResult.gone, webPushFailure(WebPushStatusException(410, "gone", null)))
        assertEquals(PushResult.gone, webPushFailure(WebPushStatusException(404, "missing", null)))
        assertEquals(PushResult.failed, webPushFailure(WebPushStatusException(500, "oops", null)))
        assertEquals(PushResult.failed, webPushFailure(java.io.IOException("a message that says gone and 404")))
    }

    @Test
    fun `fcm removes unregistered tokens but keeps the subscription on an invalid argument`() {
        assertEquals(PushResult.gone, fcmFailure(404, null))
        assertEquals(PushResult.gone, fcmFailure(400, "UNREGISTERED"))
        assertEquals(PushResult.failed, fcmFailure(400, "INVALID_ARGUMENT"))
        assertEquals(PushResult.failed, fcmFailure(503, "UNAVAILABLE"))
    }
}
