package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import alice.server.support.SupportService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

@Serializable data class SupportGrantBody(val hours: Int, val scope: Map<String, Boolean> = emptyMap())
@Serializable data class SupportExtendBody(val hours: Int = 1)

fun Route.adminSupportRoutes(support: SupportService) {
    route("/api/v1/admin/support") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            call.respond(support.state(member.membership.householdId))
        }
        post {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<SupportGrantBody>()
            call.respond(support.grant(member.membership.householdId, member.session.userId, body.hours, body.scope))
        }
        post("/{id}/extend") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Session id is required")
            val body = runCatching { call.receive<SupportExtendBody>() }.getOrDefault(SupportExtendBody())
            call.respond(support.extend(member.membership.householdId, member.session.userId, id, body.hours))
        }
        post("/{id}/end") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Session id is required")
            call.respond(support.end(member.membership.householdId, member.session.userId, id))
        }
    }
}
