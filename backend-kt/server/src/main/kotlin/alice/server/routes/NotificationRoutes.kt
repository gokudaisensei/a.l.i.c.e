package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.notifications.NotificationsService
import alice.server.permissions.Permission
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

/** A typed response: a `Map` with a list and an int cannot be serialized by Ktor and answered 500. */
@kotlinx.serialization.Serializable
data class NotificationsResponse(val notifications: List<alice.server.notifications.NotificationView>, val unread: Int)

fun Route.notificationRoutes(notifications: NotificationsService) {
    route("/api/v1/notifications") {
        get {
            val m = Guards.requirePermission(call.requestAuth(), Permission.NOTIFICATION_RECEIVE.wire)
            val unread = call.request.queryParameters["unread"] == "true"
            val limit = call.request.queryParameters["limit"]?.toIntOrNull()
            val before = call.request.queryParameters["before"]?.toLongOrNull()
            val list = notifications.list(m.session.userId, unread = unread, limit = limit ?: 50, before = before)
            call.respond(NotificationsResponse(list, notifications.unreadCount(m.session.userId)))
        }
        post("/read-all") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.NOTIFICATION_RECEIVE.wire)
            call.respond(mapOf("marked" to notifications.markAllRead(m.session.userId)))
        }
        post("/{id}/read") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.NOTIFICATION_RECEIVE.wire)
            val id = call.parameters["id"] ?: ""
            notifications.markRead(m.session.userId, id)
            call.respond(mapOf("ok" to true))
        }
    }
}
