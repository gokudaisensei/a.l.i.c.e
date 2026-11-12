package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.modes.MirrorStatus
import alice.server.insights.InsightsService
import alice.server.modes.ModeMirrorService
import alice.server.modes.ModesService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

fun Route.modeRoutes(modes: ModesService, insights: InsightsService? = null, mirror: ModeMirrorService? = null) {
    route("/api/v1/household/mode") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val state = modes.get(member.membership.householdId)
            val canSuggest = member.membership.role.wire != "guest"
            val suggestion = if (canSuggest) insights?.suggestion(member.membership.householdId, state.mode)?.let {
                buildJsonObject {
                    put("id", JsonPrimitive(it.id))
                    put("kind", JsonPrimitive(it.kind))
                    put("title", JsonPrimitive(it.title))
                    put("reason", JsonPrimitive(it.reason))
                    put("key", JsonPrimitive(it.key))
                    put("action", buildJsonObject {
                        put("type", JsonPrimitive(it.action.type))
                        put("mode", JsonPrimitive(it.action.mode))
                    })
                }
            } else null
            val mirrorStatus = if (mirror != null) mirror.status(member.membership.householdId) else MirrorStatus("unavailable", "Home Assistant mode helper not connected")
            call.respond(ModeResponse(state.mode, state.changedAt, state.changedBy?.let { ModeActor(it, it) }, mirrorStatus, suggestion))
        }
        put {
            val member = Guards.requirePermission(call.requestAuth(), "mode.change")
            val body = call.receive<ModeBody>()
            val state = modes.set(member.membership.householdId, member.session.userId, body.mode)
            call.respond(ModeSimpleResponse(state.mode, state.changedAt, state.changedBy?.let { ModeActor(it, it) }))
        }
    }
}

@Serializable data class ModeActor(val id: String, val displayName: String)
@Serializable data class ModeResponse(val mode: String, val changedAt: Long?, val changedBy: ModeActor?, val mirror: MirrorStatus, val suggestion: kotlinx.serialization.json.JsonElement? = null)
@Serializable data class ModeSimpleResponse(val mode: String, val changedAt: Long?, val changedBy: ModeActor?)
@Serializable data class ModeBody(val mode: String)
