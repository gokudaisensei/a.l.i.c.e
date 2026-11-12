package alice.server.notifications

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.server.notifications.push.PushKeys
import alice.server.notifications.push.PushPayload
import alice.server.notifications.push.PushProvider
import alice.server.notifications.push.PushResult
import alice.server.notifications.push.PushSubscription
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import java.net.URI
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Serializable
data class RegisterWebPush(val platform: String = "webpush", val token: String, val keys: PushKeys, val label: String? = null)
@Serializable
data class RegisterFcm(val platform: String = "fcm", val token: String, val label: String? = null)

class PushService(
    private val db: Database,
    private val providers: List<PushProvider>,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false },
    webPushHostAllowlist: List<String> = emptyList(),
) {
    private val log = LoggerFactory.getLogger(PushService::class.java)
    private val rate = java.util.concurrent.ConcurrentHashMap<String, MutableList<Long>>()
    private val webPushHostAllowlist: List<Regex> =
        if (webPushHostAllowlist.isEmpty()) DEFAULT_WEBPUSH_HOSTS else webPushHostAllowlist.map { Regex(it) }

    companion object {
        const val MAX_SUBSCRIPTIONS_PER_USER = 10
        val DEFAULT_WEBPUSH_HOSTS = listOf(
            Regex("^fcm\\.googleapis\\.com$"),
            Regex("(^|\\.)push\\.services\\.mozilla\\.com$"),
            Regex("(^|\\.)notify\\.windows\\.com$"),
            Regex("(^|\\.)push\\.apple\\.com$"),
        )
        private val B64URL = Regex("^[A-Za-z0-9_-]{16,200}$")
    }

    fun platforms(): List<String> = providers.map { it.platform }
    fun vapidPublicKey(): String? = providers.firstOrNull { it.platform == "webpush" }?.publicKey

    private fun toSub(row: alice.core.db.Push_subscriptions): PushSubscription {
        val keys = row.keys?.let { runCatching { json.decodeFromString<PushKeys>(it) }.getOrNull() }
        return PushSubscription(row.id, row.user_id, row.platform, row.token, keys, row.label, row.created_at, row.last_used_at)
    }

    fun list(userId: String): List<PushSubscription> =
        db.read { identityQueries.selectPushSubscriptionsByUser(userId).executeAsList() }.map(::toSub)

    fun registerWebPush(userId: String, token: String, keys: PushKeys, label: String?): PushSubscription {
        if (providers.none { it.platform == "webpush" }) throw AppException(ErrorCode.CONFLICT, "This server is not set up to send Web Push notifications", 409)
        val uri = try { URI(token) } catch (_: Exception) { throw alice.core.error.validationError("The subscription endpoint is not a URL") }
        if (uri.scheme != "https" || uri.userInfo != null || webPushHostAllowlist.none { it.matches(uri.host ?: "") }) {
            throw alice.core.error.validationError("That push service is not supported")
        }
        if (!B64URL.matches(keys.p256dh) || !B64URL.matches(keys.auth)) throw alice.core.error.validationError("The subscription keys are missing or malformed")
        return upsert(userId, "webpush", token, json.encodeToString(keys), label)
    }

    fun registerFcm(userId: String, token: String, label: String?): PushSubscription {
        if (providers.none { it.platform == "fcm" }) throw AppException(ErrorCode.CONFLICT, "This server is not set up to send Firebase notifications", 409)
        if (token.length < 20 || token.length > 4096) throw alice.core.error.validationError("That does not look like a device token")
        return upsert(userId, "fcm", token, null, label)
    }

    private fun upsert(userId: String, platform: String, token: String, keysJson: String?, label: String?): PushSubscription {
        val now = time.now()
        val id = db.write {
            val existing = identityQueries.selectPushSubscriptionByUnique(userId, platform, token).executeAsOneOrNull()
            if (existing != null) {
                identityQueries.updatePushSubscription(keysJson, label?.take(80) ?: existing.label, existing.id)
                val reassigned = identityQueries.deletePushSubscriptionsByPlatformTokenExceptUser(platform, token, userId).executeAsList()
                if (reassigned.isNotEmpty()) {
                    Audit.write(this, action = "push.device_reassigned", householdId = null, actorId = userId, resource = platform, now = now)
                }
                existing.id
            } else {
                val count = identityQueries.countPushSubscriptionsByUser(userId).executeAsOne()
                if (count >= MAX_SUBSCRIPTIONS_PER_USER) throw AppException(ErrorCode.CONFLICT, "At most $MAX_SUBSCRIPTIONS_PER_USER devices per person; remove one first", 409)
                val id = Ids.next("psh")
                val reassigned = identityQueries.deletePushSubscriptionsByPlatformTokenExceptUser(platform, token, userId).executeAsList()
                identityQueries.insertPushSubscription(id, userId, platform, token, keysJson, label?.take(80), now, null)
                if (reassigned.isNotEmpty()) {
                    Audit.write(this, action = "push.device_reassigned", householdId = null, actorId = userId, resource = platform, now = now)
                }
                id
            }
        }
        return list(userId).first { it.id == id }
    }

    fun unregister(userId: String, id: String) {
        val hit = db.write { identityQueries.deletePushSubscriptionByIdAndUser(id, userId).executeAsList() }
        if (hit.isEmpty()) throw notFound("Device")
    }

    private fun inQuietHours(userId: String, householdId: String): Boolean {
        val pref = db.read { identityQueries.selectUserPreferences(userId).executeAsOneOrNull() } ?: return false
        val q = pref.quiet_hours ?: return false
        val obj = runCatching { json.parseToJsonElement(q).jsonObject }.getOrNull() ?: return false
        val enabled = (obj["enabled"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull() ?: false
        if (!enabled) return false
        val from = obj["from"]?.jsonPrimitive?.content ?: return false
        val to = obj["to"]?.jsonPrimitive?.content ?: return false
        val tzName = db.read { identityQueries.selectHouseholdById(householdId).executeAsOneOrNull() }?.timezone ?: "UTC"
        val tz = try { ZoneId.of(tzName) } catch (_: Throwable) { ZoneId.of("UTC") }
        val now = Instant.ofEpochMilli(time.now()).atZone(tz)
        val label = DateTimeFormatter.ofPattern("h:mm a", Locale.US).format(now).lowercase(Locale.US)
        val m = Regex("^(\\d{1,2}):(\\d{2}) (am|pm)$").find(label) ?: return false
        val nowMin = ((m.groupValues[1].toInt() % 12) + if (m.groupValues[3] == "pm") 12 else 0) * 60 + m.groupValues[2].toInt()
        fun toMin(hhmm: String): Int { val p = hhmm.split(":"); return p[0].toInt() * 60 + p[1].toInt() }
        val f = toMin(from); val t = toMin(to)
        return if (f <= t) nowMin in f until t else nowMin >= f || nowMin < t
    }

    private fun rateAllowed(userId: String): Boolean {
        val now = time.now()
        val list = rate.getOrPut(userId) { mutableListOf() }
        synchronized(list) {
            list.removeAll { it < now - 10 * 60_000L }
            if (list.size >= 30) return false
            list.add(now)
            return true
        }
    }

    suspend fun deliver(notificationId: String, householdId: String, userId: String, kind: String, title: String, body: String, urgent: Boolean): String {
        try {
            val pref = db.read { identityQueries.selectUserPreferences(userId).executeAsOneOrNull() }
            if (pref != null && pref.push_enabled == 0L) { db.write { identityQueries.updateNotificationPushStatus("suppressed", notificationId) }; return "suppressed" }
            if (!urgent && inQuietHours(userId, householdId)) { db.write { identityQueries.updateNotificationPushStatus("suppressed", notificationId) }; return "suppressed" }
            val subs = list(userId)
            if (subs.isEmpty()) { db.write { identityQueries.updateNotificationPushStatus("none", notificationId) }; return "none" }
            if (!rateAllowed(userId)) { db.write { identityQueries.updateNotificationPushStatus("suppressed", notificationId) }; return "suppressed" }
            val payload = PushPayload(title, body, mapOf("notificationId" to notificationId, "kind" to kind))
            var sent = 0
            for (sub in subs) {
                val provider = providers.firstOrNull { it.platform == sub.platform } ?: continue
                val r = try { provider.send(sub, payload) } catch (e: Exception) { log.warn("push delivery failed for ${sub.id}", e); PushResult.failed }
                when (r) {
                    PushResult.sent -> { sent++; db.write { identityQueries.updatePushSubscriptionLastUsed(time.now(), sub.id) } }
                    PushResult.gone -> db.write { identityQueries.deletePushSubscriptionById(sub.id) }
                    PushResult.failed -> log.warn("push delivery failed for ${sub.id} ${sub.platform}")
                }
            }
            val status = if (sent > 0) "sent" else "failed"
            db.write { identityQueries.updateNotificationPushStatus(status, notificationId) }
            return status
        } catch (e: Exception) {
            log.error("push delivery crashed", e)
            runCatching { db.write { identityQueries.updateNotificationPushStatus("failed", notificationId) } }
            return "failed"
        }
    }

    suspend fun sendTest(userId: String): Map<String, Int> {
        var sent = 0; var removed = 0; var failed = 0
        for (sub in list(userId)) {
            val provider = providers.firstOrNull { it.platform == sub.platform } ?: continue
            val r = try { provider.send(sub, PushPayload("Alice", "Notifications are working on this device.", mapOf("kind" to "test"))) } catch (_: Exception) { PushResult.failed }
            when (r) {
                PushResult.sent -> sent++
                PushResult.gone -> { removed++; db.write { identityQueries.deletePushSubscriptionById(sub.id) } }
                PushResult.failed -> failed++
            }
        }
        return mapOf("sent" to sent, "removed" to removed, "failed" to failed)
    }
}
