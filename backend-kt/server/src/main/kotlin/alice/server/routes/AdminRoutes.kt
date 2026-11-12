package alice.server.routes

import alice.server.admin.AdminService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route

fun Route.adminRoutes(admin: AdminService) {
    route("/api/v1/admin") {
        get("/health") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ADMIN_VIEW.wire)
            call.respond(admin.health(member.membership.householdId))
        }
        get("/diagnostics") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ADMIN_VIEW.wire)
            call.respond(admin.diagnostics(member.membership.householdId))
        }
        get("/metrics") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ADMIN_VIEW.wire)
            call.respond(admin.metrics(member.membership.householdId))
        }
        get("/audit") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ADMIN_VIEW.wire)
            val q = call.request.queryParameters
            call.respond(admin.audit(
                member.membership.householdId,
                q["limit"]?.toIntOrNull() ?: 50,
                q["before"],
                q["action"],
            ))
        }
    }
}
