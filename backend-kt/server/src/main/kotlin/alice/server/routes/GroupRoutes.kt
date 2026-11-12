package alice.server.routes

import alice.server.commands.toPublicCommand
import alice.server.groups.GroupsService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.things.Caller
import io.ktor.http.HttpStatusCode
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

fun Route.groupRoutes(groups: GroupsService) {
    route("/api/v1/groups") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), "device.view")
            call.respond(GroupsResponse(groups.list(caller(member))))
        }
        post {
            val member = Guards.requirePermission(call.requestAuth(), "group.write")
            val body = call.receive<CreateGroupBody>()
            call.respond(groups.create(caller(member), body.name, body.icon, body.thingIds))
        }
        get("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), "device.view")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Group id is required")
            call.respond(groups.get(caller(member), id))
        }
        patch("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), "group.write")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Group id is required")
            val body = call.receive<UpdateGroupBody>()
            call.respond(groups.update(caller(member), id, body.name, body.icon != null, body.icon, body.thingIds))
        }
        delete("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), "group.write")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Group id is required")
            groups.remove(caller(member), id)
            call.respond(OkResponse())
        }
        post("/{id}/commands") {
            val member = Guards.requirePermission(call.requestAuth(), "device.control")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Group id is required")
            val body = call.receive<GroupCommandBody>()
            val (cmds, skipped) = groups.command(caller(member), id, body.action, body.parameters ?: emptyMap(), body.target ?: "first")
            call.response.status(HttpStatusCode.Accepted)
            call.respond(GroupCommandResponse(cmds.map { toPublicCommand(it) }, skipped))
        }
    }
}

private fun caller(member: alice.server.http.MemberContext) = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)

@Serializable data class GroupsResponse(val groups: List<alice.server.groups.GroupView>)
@Serializable data class CreateGroupBody(val name: String, val icon: String? = null, val thingIds: List<String> = emptyList())
@Serializable data class UpdateGroupBody(val name: String? = null, val icon: String? = null, val thingIds: List<String>? = null)
@Serializable data class GroupCommandBody(val action: String, val parameters: Map<String, JsonElement>? = null, val target: String? = null)
@Serializable data class GroupCommandResponse(val commands: List<alice.server.commands.PublicCommand>, val skipped: List<alice.server.actions.SkippedAction>)
