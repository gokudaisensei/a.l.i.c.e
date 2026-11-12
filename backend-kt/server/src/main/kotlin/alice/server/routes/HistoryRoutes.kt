package alice.server.routes

import alice.server.history.HistoryService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route

fun Route.historyRoutes(history: HistoryService) {
    route("/api/v1/history") {
        get("/devices/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.HISTORY_VIEW.wire)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Device id is required")
            val q = call.request.queryParameters
            val out = history.device(
                alice.server.things.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp),
                id,
                q["from"],
                q["to"],
                q["entityId"],
                q["maxPoints"]?.toIntOrNull(),
            )
            call.respond(out)
        }
    }
}
