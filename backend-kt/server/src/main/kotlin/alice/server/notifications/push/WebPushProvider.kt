package alice.server.notifications.push

import com.interaso.webpush.VapidKeys
import com.interaso.webpush.WebPush
import com.interaso.webpush.WebPushService
import com.interaso.webpush.WebPushStatusException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.util.Base64

class WebPushProvider(
    publicKeyRaw: String,
    privateKeyRaw: String,
    subject: String,
) : PushProvider {
    override val platform: String = "webpush"
    private val log = LoggerFactory.getLogger(WebPushProvider::class.java)
    private val json = Json { encodeDefaults = true; explicitNulls = false }

    val keys: VapidKeys = parseKeys(publicKeyRaw, privateKeyRaw)
    override val publicKey: String = let {
        val k: Any = keys.applicationServerKey
        when (k) {
            is String -> k
            is ByteArray -> Base64.getUrlEncoder().withoutPadding().encodeToString(k)
            else -> k.toString()
        }
    }

    private val service = WebPushService(subject = subject, vapidKeys = keys)
    private val helper = WebPush(subject, keys)

    override suspend fun send(sub: PushSubscription, payload: PushPayload): PushResult {
        val subKeys = sub.keys ?: return PushResult.gone
        return try {
            val body = json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(), buildJsonObject {
                put("title", payload.title)
                put("body", payload.body)
                val data = kotlinx.serialization.json.buildJsonObject {
                    payload.data.forEach { (k, v) -> put(k, v) }
                }
                put("data", data)
            })
            webPushResult(service.send(
                payload = body,
                endpoint = sub.token,
                p256dh = subKeys.p256dh,
                auth = subKeys.auth,
                ttl = 3600,
            ))
        } catch (e: Exception) {
            webPushFailure(e).also { if (it == PushResult.failed) log.debug("webpush send failed: {}", e.message) }
        }
    }

    companion object {
        fun parseKeys(publicKey: String, privateKey: String): VapidKeys {
            // Try uncompressed base64url bytes first (common web-push format, 65-byte public key)
            runCatching { VapidKeys.fromUncompressedBytes(publicKey, privateKey) }.getOrNull()?.let { return it }
            // Try X509/PKCS8
            runCatching { VapidKeys.create(publicKey, privateKey) }.getOrNull()?.let { return it }
            // Try standard base64 variants
            val pub = normalizeB64(publicKey)
            val priv = normalizeB64(privateKey)
            runCatching { VapidKeys.fromUncompressedBytes(pub, priv) }.getOrNull()?.let { return it }
            runCatching { VapidKeys.create(pub, priv) }.getOrNull()?.let { return it }
            throw IllegalArgumentException("Unsupported VAPID key format")
        }

        private fun normalizeB64(s: String): String {
            val t = s.trim().replace('-', '+').replace('_', '/')
            val pad = (4 - (t.length % 4)) % 4
            val padded = t + "=".repeat(pad)
            return Base64.getEncoder().encodeToString(Base64.getDecoder().decode(padded))
                .replace('+', '-').replace('/', '_').replace("=", "") // prefer base64url style back
        }
    }
}

/** The push service says whether the subscription still exists; expired ones are dropped. */
internal fun webPushResult(state: WebPush.SubscriptionState): PushResult = when (state) {
    WebPush.SubscriptionState.ACTIVE -> PushResult.sent
    WebPush.SubscriptionState.EXPIRED -> PushResult.gone
}

/** 404 and 410 mean the browser unsubscribed; anything else (network, 5xx, bad keys) is worth keeping the subscription for. */
internal fun webPushFailure(e: Exception): PushResult =
    if (e is WebPushStatusException && e.statusCode in setOf(404, 410)) PushResult.gone else PushResult.failed
