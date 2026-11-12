package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.notifications.AlertsService
import alice.server.permissions.Permission
import alice.server.things.Caller
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

fun Route.alertRoutes(alerts: AlertsService) {
    route("/api/v1/alerts") {
        get {
            val m = Guards.requirePermission(call.requestAuth(), Permission.NOTIFICATION_RECEIVE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val includeCleared = call.request.queryParameters["includeCleared"] == "true"
            call.respond(mapOf("alerts" to alerts.list(c, includeCleared)))
        }
        post("/{id}/ack") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.NOTIFICATION_RECEIVE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: ""
            call.respond(alerts.ack(c, id))
        }
    }
}
