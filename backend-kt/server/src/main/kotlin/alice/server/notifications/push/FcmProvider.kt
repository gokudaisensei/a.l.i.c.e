package alice.server.notifications.push

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.KeyFactory
import java.security.Signature
import java.security.interfaces.RSAPrivateKey
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Instant
import java.util.Base64

class FcmProvider(
    private val serviceAccountJson: String,
    private val http: HttpClient = HttpClient.newHttpClient(),
    private val nowMs: () -> Long = { System.currentTimeMillis() },
) : PushProvider {
    override val platform: String = "fcm"
    private val log = LoggerFactory.getLogger(FcmProvider::class.java)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
    private val account: ServiceAccount = json.decodeFromString(serviceAccountJson)
    @Volatile private var token: CachedToken? = null

    override suspend fun send(sub: PushSubscription, payload: PushPayload): PushResult {
        return try {
            val access = accessToken()
            val body = json.encodeToString(FcmSendRequest.serializer(), FcmSendRequest(
                message = FcmMessage(
                    token = sub.token,
                    notification = FcmNotification(payload.title, payload.body),
                    data = payload.data,
                    android = FcmAndroid(priority = "high"),
                    apns = FcmApns(headers = mapOf("apns-priority" to "10")),
                )
            ))
            val req = HttpRequest.newBuilder()
                .uri(URI.create("https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send"))
                .header("authorization", "Bearer $access")
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build()
            val res = http.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() in 200..299) return PushResult.sent
            val err = runCatching { json.parseToJsonElement(res.body()).jsonObject["error"]?.jsonObject }.getOrNull()
            val code = err?.get("details")?.let { details ->
                (details as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonObject)?.get("errorCode")?.jsonPrimitive?.content }?.firstOrNull()
            } ?: err?.get("status")?.jsonPrimitive?.content
            if (res.statusCode() == 401) token = null
            fcmFailure(res.statusCode(), code)
        } catch (e: Exception) {
            log.debug("fcm send failed: {}", e.message)
            PushResult.failed
        }
    }

    @Synchronized
    private fun accessToken(): String {
        val t = token
        val now = nowMs()
        if (t != null && t.expiresAt - 60_000 > now) return t.value
        val aud = account.token_uri ?: "https://oauth2.googleapis.com/token"
        val iat = (now / 1000)
        val header = b64url(json.encodeToString(mapOf("alg" to "RS256", "typ" to "JWT")))
        val claim = b64url(json.encodeToString(mapOf(
            "iss" to account.client_email,
            "scope" to "https://www.googleapis.com/auth/firebase.messaging",
            "aud" to aud,
            "iat" to iat.toString(),
            "exp" to (iat + 3600).toString(),
        )))
        val unsigned = "$header.$claim"
        val sig = Signature.getInstance("SHA256withRSA")
        sig.initSign(loadPrivateKey(account.private_key))
        sig.update(unsigned.toByteArray(Charsets.UTF_8))
        val jwt = "$unsigned.${b64urlRaw(sig.sign())}"
        val form = "grant_type=${urlEnc("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${urlEnc(jwt)}"
        val req = HttpRequest.newBuilder()
            .uri(URI.create(aud))
            .header("content-type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form))
            .build()
        val res = http.send(req, HttpResponse.BodyHandlers.ofString())
        if (res.statusCode() !in 200..299) throw IllegalStateException("FCM token request failed (${res.statusCode()})")
        val tok = json.parseToJsonElement(res.body()).jsonObject
        val access = tok["access_token"]?.jsonPrimitive?.content ?: throw IllegalStateException("FCM token missing")
        val expIn = tok["expires_in"]?.jsonPrimitive?.content?.toLongOrNull() ?: 3600L
        val cached = CachedToken(access, now + expIn * 1000)
        token = cached
        return cached.value
    }

    private fun loadPrivateKey(pem: String): RSAPrivateKey {
        val clean = pem.replace("-----BEGIN PRIVATE KEY-----", "")
            .replace("-----END PRIVATE KEY-----", "")
            .replace("\\n", "")
            .replace("\n", "")
            .replace("\r", "")
            .trim()
        val bytes = Base64.getDecoder().decode(clean)
        return KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(bytes)) as RSAPrivateKey
    }

    private fun b64url(s: String): String = b64urlRaw(s.toByteArray(Charsets.UTF_8))
    private fun b64urlRaw(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    private fun urlEnc(s: String): String = java.net.URLEncoder.encode(s, Charsets.UTF_8)

    @Serializable data class ServiceAccount(val project_id: String, val client_email: String, val private_key: String, val token_uri: String? = null)
    data class CachedToken(val value: String, val expiresAt: Long)
    @Serializable data class FcmSendRequest(val message: FcmMessage)
    @Serializable data class FcmMessage(
        val token: String,
        val notification: FcmNotification,
        val data: Map<String, String> = emptyMap(),
        val android: FcmAndroid? = null,
        val apns: FcmApns? = null,
    )
    @Serializable data class FcmNotification(val title: String, val body: String)
    @Serializable data class FcmAndroid(val priority: String? = null)
    @Serializable data class FcmApns(val headers: Map<String, String> = emptyMap())
}

/**
 * Only a token FCM no longer knows is removed. INVALID_ARGUMENT usually means our own payload was wrong,
 * and deleting every device's subscription for that would silence notifications until each re-registers.
 */
internal fun fcmFailure(status: Int, errorCode: String?): PushResult =
    if (status == 404 || errorCode == "UNREGISTERED") PushResult.gone else PushResult.failed
