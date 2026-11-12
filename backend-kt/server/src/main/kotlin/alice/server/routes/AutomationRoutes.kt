package alice.server.routes

import alice.core.error.validationError
import alice.server.automations.AutomationsService
import alice.server.automations.Caller
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

fun Route.automationRoutes(automations: AutomationsService) {
    route("/api/v1/automations") {
        get {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            call.respond(mapOf("automations" to automations.list(c)))
        }
        post {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val body = call.receive<AutomationCreateBody>()
            call.respond(automations.create(c, body.name, body.enabled, body.definition))
        }
        post("/preview") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val body = call.receive<AutomationPreviewBody>()
            call.respond(automations.preview(c, body.name ?: "Preview", body.definition))
        }
        get("/{id}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            call.respond(automations.get(c, id))
        }
        patch("/{id}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            val body = call.receive<AutomationPatchBody>()
            call.respond(automations.update(c, id, body.name, body.enabled, body.definition))
        }
        delete("/{id}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            automations.remove(c, id)
            call.respond(mapOf("ok" to true))
        }
        post("/{id}/enable") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            call.respond(automations.setEnabled(c, id, true))
        }
        post("/{id}/disable") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            call.respond(automations.setEnabled(c, id, false))
        }
        post("/{id}/test") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            val a = automations.get(c, id)
            call.respond(automations.preview(c, a.name, a.definition))
        }
        post("/{id}/run") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            call.respond(automations.runNow(c, id))
        }
        get("/{id}/runs") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.AUTOMATION_WRITE.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            call.respond(mapOf("runs" to automations.runs(c, id)))
        }
    }
}

@Serializable data class AutomationCreateBody(val name: String, val enabled: Boolean? = null, val definition: JsonElement)
@Serializable data class AutomationPreviewBody(val name: String? = null, val definition: JsonElement)
@Serializable data class AutomationPatchBody(val name: String? = null, val enabled: Boolean? = null, val definition: JsonElement? = null)
