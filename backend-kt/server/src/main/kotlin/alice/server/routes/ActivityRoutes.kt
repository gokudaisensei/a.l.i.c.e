package alice.server.routes

import alice.server.activity.ActivityService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import alice.server.things.Caller
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

fun Route.activityRoutes(activity: ActivityService) {
    route("/api/v1/activity") {
        get {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ACTIVITY_VIEW.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val limit = call.request.queryParameters["limit"]?.toIntOrNull() ?: 30
            val before = call.request.queryParameters["before"]
            val kind = call.request.queryParameters["kind"]
            call.respond(activity.list(c, limit, before, kind))
        }
        post("/seen") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ACTIVITY_VIEW.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            activity.markSeen(c)
            call.respond(mapOf("ok" to true))
        }
    }
}
