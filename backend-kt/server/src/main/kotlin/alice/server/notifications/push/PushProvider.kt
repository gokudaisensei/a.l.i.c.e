package alice.server.notifications.push

import kotlinx.serialization.Serializable

@Serializable
data class PushKeys(val p256dh: String, val auth: String)

data class PushSubscription(
    val id: String,
    val userId: String,
    val platform: String,
    val token: String,
    val keys: PushKeys?,
    val label: String?,
    val createdAt: Long,
    val lastUsedAt: Long?,
)

@Serializable
data class PushPayload(
    val title: String,
    val body: String,
    val data: Map<String, String> = emptyMap(),
)

enum class PushResult { sent, gone, failed }

interface PushProvider {
    val platform: String
    val publicKey: String? get() = null
    suspend fun send(sub: PushSubscription, payload: PushPayload): PushResult
}
