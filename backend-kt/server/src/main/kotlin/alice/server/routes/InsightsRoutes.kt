package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.insights.InsightsService
import alice.server.permissions.Permission
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

fun Route.insightsRoutes(insights: InsightsService) {
    route("/api/v1/insights") {
        get {
            val m = Guards.requirePermission(call.requestAuth(), Permission.MODE_CHANGE.wire)
            call.respond(mapOf("insights" to insights.list(m.membership.householdId)))
        }
        post("/{id}/dismiss") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.MODE_CHANGE.wire)
            val id = call.parameters["id"] ?: ""
            insights.dismiss(m.membership.householdId, id)
            call.respond(mapOf("ok" to true))
        }
    }
}
