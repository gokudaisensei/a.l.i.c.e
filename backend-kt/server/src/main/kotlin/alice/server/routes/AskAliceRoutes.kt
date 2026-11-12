package alice.server.routes

import alice.server.ai.AskAliceService
import alice.server.ai.AskAliceSettingsPatch
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable data class InterpretBody(val text: String = "")

fun Route.askAliceRoutes(assistant: AskAliceService) {
    route("/api/v1/ai") {
        get("/settings") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            call.respond(assistant.settings(member.membership.householdId))
        }
        put("/settings") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = runCatching { call.receive<AskAliceSettingsPatch>() }.getOrDefault(AskAliceSettingsPatch())
            call.respond(assistant.updateSettings(member.membership.householdId, body))
        }
        post("/interpret") {
            val member = Guards.requireMember(call.requestAuth())
            val text = runCatching { call.receive<InterpretBody>() }.getOrDefault(InterpretBody()).text
            val items = assistant.interpret(member.membership.householdId, member.session.userId, member.membership.role.wire, text)
            call.respond(buildJsonObject {
                put("items", Json.encodeToJsonElement(ListSerializer(alice.server.ai.Suggestion.serializer()), items))
            })
        }
    }
}
