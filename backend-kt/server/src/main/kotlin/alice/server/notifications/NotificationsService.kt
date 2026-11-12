package alice.server.notifications

import alice.core.db.Database
import alice.core.error.notFound
import alice.core.events.EventBus
import alice.core.events.NotificationCreated
import alice.core.ids.Ids
import alice.core.time.TimeProvider
import alice.server.households.HouseholdService
import alice.server.households.Role
import alice.server.permissions.can
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class NotificationView(
    val id: String,
    val kind: String,
    val title: String,
    val body: String,
    val data: JsonElement? = null,
    val createdAt: Long,
    val readAt: Long? = null,
)

data class NewNotification(
    val kind: String,
    val title: String,
    val body: String,
    val data: JsonElement? = null,
    val urgent: Boolean = false,
)

class NotificationsService(
    private val db: Database,
    private val bus: EventBus,
    private val households: HouseholdService,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false },
) {
    var onCreated: (suspend (NotificationCreatedPayload) -> Unit)? = null

    data class NotificationCreatedPayload(
        val id: String,
        val householdId: String,
        val userId: String,
        val kind: String,
        val title: String,
        val body: String,
        val urgent: Boolean,
    )

    /** People who currently belong to the household and may receive notifications (not guests, not expired). */
    fun recipients(householdId: String): List<String> {
        return households.listMembers(householdId)
            .filter { !it.isExpired() && can(it.role, "notification.receive") }
            .map { it.userId }
    }

    private fun alice.server.households.MemberView.isExpired(): Boolean = expiresAt != null && expiresAt <= time.now()

    private fun parseData(s: String?): JsonElement? = s?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() }

    private fun view(id: String, kind: String, title: String, body: String, data: String?, createdAt: Long, readAt: Long?): NotificationView =
        NotificationView(id, kind, title, body, parseData(data), createdAt, readAt)

    fun notify(householdId: String, userId: String, n: NewNotification): NotificationView {
        val now = time.now()
        val id = Ids.next("ntf")
        val title = n.title.take(100)
        val body = n.body.take(500)
        val dataStr = n.data?.let { json.encodeToString(it) }
        db.write {
            identityQueries.insertNotification(id, householdId, userId, n.kind, title, body, dataStr, if (n.urgent) 1 else 0, "none", now, null)
        }
        bus.publish(NotificationCreated(householdId, now.toString(), userId, id, mutableMapOf("id" to id, "kind" to n.kind, "title" to title, "body" to body)))
        val hook = onCreated
        if (hook != null) {
            // best-effort async delivery hook; caller can choose to run in background
            kotlinx.coroutines.runBlocking { runCatching { hook(NotificationCreatedPayload(id, householdId, userId, n.kind, title, body, n.urgent)) } }
        }
        return NotificationView(id, n.kind, title, body, n.data, now, null)
    }

    fun notifyHousehold(householdId: String, n: NewNotification): List<NotificationView> =
        recipients(householdId).map { notify(householdId, it, n) }

    /**
     * Notifies the named people, but only those who are current recipients in this household. Ids come from an
     * automation's definition or from a Home Assistant event, so they are not trusted: anyone else is skipped.
     */
    fun notifyUsers(householdId: String, userIds: Collection<String>, n: NewNotification): List<NotificationView> {
        val allowed = recipients(householdId).toSet()
        return userIds.distinct().filter { it in allowed }.map { notify(householdId, it, n) }
    }

    fun notifyAdmins(householdId: String, n: NewNotification): List<NotificationView> {
        val admins = households.listMembers(householdId).filter { !it.isExpired() && it.role == Role.ADMIN }.map { it.userId }.toSet()
        return recipients(householdId).filter { it in admins }.map { notify(householdId, it, n) }
    }

    fun get(userId: String, id: String): NotificationView? {
        val r = db.read { identityQueries.selectNotificationByIdAndUser(id, userId).executeAsOneOrNull() } ?: return null
        return view(r.id, r.kind, r.title, r.body, r.data_, r.created_at, r.read_at)
    }

    fun list(userId: String, unread: Boolean = false, limit: Int = 50, before: Long? = null): List<NotificationView> {
        val lim = limit.coerceIn(1, 200).toLong()
        val rows = db.read { identityQueries.selectNotificationsByUser(userId, if (unread) 1L else 0L, before, lim).executeAsList() }
        return rows.map { view(it.id, it.kind, it.title, it.body, it.data_, it.created_at, it.read_at) }
    }

    fun unreadCount(userId: String): Int = db.read { identityQueries.selectUnreadNotificationsCount(userId).executeAsOne() }.toInt()

    fun markRead(userId: String, id: String) {
        val now = time.now()
        val hit = db.write { identityQueries.markNotificationRead(now, id, userId).executeAsList() }
        if (hit.isEmpty()) throw notFound("Notification")
    }

    fun markAllRead(userId: String): Int {
        val now = time.now()
        return db.write { identityQueries.markAllNotificationsRead(now, userId).executeAsList().size }
    }

    fun setPushStatus(id: String, status: String) {
        db.write { identityQueries.updateNotificationPushStatus(status, id) }
    }
}
