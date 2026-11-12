package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import alice.server.updates.UpdateService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable data class EmergencyUpdateBody(val reason: String = "", val confirmation: String = "")
@Serializable data class RollbackBody(val restoreData: Boolean = false)

fun Route.updateRoutes(updates: UpdateService) {
    route("/api/v1/updates") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            call.respond(updates.status(member.membership.householdId))
        }
        post("/check") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            call.respond(updates.check(member.membership.householdId))
        }
        get("/history") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            val items = updates.history(member.membership.householdId)
            call.respond(buildJsonObject {
                put("items", Json.encodeToJsonElement(ListSerializer(alice.server.updates.UpdateView.serializer()), items))
            })
        }
        put("/settings") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<UpdateService.UpdateSettingsPatch>()
            call.respond(updates.updateSettings(member.membership.householdId, member.session.userId, body))
        }
        post("/schedule") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            Guards.requireStepUp(member.session)
            call.respond(updates.schedule(member.membership.householdId, member.session.userId))
        }
        post("/install") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            Guards.requireStepUp(member.session)
            call.respond(updates.installNow(member.membership.householdId, member.session.userId))
        }
        post("/emergency") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<EmergencyUpdateBody>()
            call.respond(updates.emergency(member.membership.householdId, member.session.userId, body.reason, body.confirmation))
        }
        post("/{id}/rollback") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Update id is required")
            val body = runCatching { call.receive<RollbackBody>() }.getOrDefault(RollbackBody())
            val out = updates.rollback(member.membership.householdId, member.session.userId, id, body.restoreData)
            // return as JSON-friendly structure
            call.respond(out)
        }
        post("/{id}/cancel") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.UPDATE_MANAGE.wire)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Update id is required")
            call.respond(updates.cancel(member.membership.householdId, member.session.userId, id))
        }
    }
}
