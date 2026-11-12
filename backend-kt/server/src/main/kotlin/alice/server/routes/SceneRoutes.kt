package alice.server.routes

import alice.server.commands.toPublicCommand
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.scenes.ScenesService
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

fun Route.sceneRoutes(scenes: ScenesService) {
    route("/api/v1/scenes") {
        get {
            val member = Guards.requirePermission(call.requestAuth(), "scene.run")
            call.respond(ScenesResponse(scenes.list(caller(member))))
        }
        post {
            val member = Guards.requirePermission(call.requestAuth(), "scene.write")
            val body = call.receive<CreateSceneBody>()
            call.respond(scenes.create(caller(member), body.name, body.icon, body.description, body.actions))
        }
        get("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), "scene.run")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Scene id is required")
            call.respond(scenes.get(caller(member), id))
        }
        patch("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), "scene.write")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Scene id is required")
            val body = call.receive<UpdateSceneBody>()
            call.respond(scenes.update(caller(member), id, body.name, body.icon != null, body.icon, body.description != null, body.description, body.actions))
        }
        delete("/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), "scene.write")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Scene id is required")
            scenes.remove(caller(member), id)
            call.respond(OkResponse())
        }
        post("/{id}/activate") {
            val member = Guards.requirePermission(call.requestAuth(), "scene.run")
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Scene id is required")
            val (cmds, skipped) = scenes.activate(caller(member), id)
            call.response.status(HttpStatusCode.Accepted)
            call.respond(SceneActivateResponse(cmds.map { toPublicCommand(it) }, skipped))
        }
    }
}

private fun caller(member: alice.server.http.MemberContext) = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)

@Serializable data class ScenesResponse(val scenes: List<alice.server.scenes.SceneView>)
@Serializable data class CreateSceneBody(val name: String, val icon: String? = null, val description: String? = null, val actions: List<alice.server.actions.ActionSpec>)
@Serializable data class UpdateSceneBody(val name: String? = null, val icon: String? = null, val description: String? = null, val actions: List<alice.server.actions.ActionSpec>? = null)
@Serializable data class SceneActivateResponse(val commands: List<alice.server.commands.PublicCommand>, val skipped: List<alice.server.actions.SkippedAction>)
