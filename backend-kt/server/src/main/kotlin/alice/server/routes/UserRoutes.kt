package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.notifications.PushService
import alice.server.notifications.push.PushKeys
import alice.server.users.QuietHours
import alice.server.users.UserService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.patch
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

fun Route.userRoutes(users: UserService, push: PushService) {
    route("/api/v1/users") {
        get("/me") {
            val member = Guards.requireMember(call.requestAuth())
            val u = users.get(member.session.userId)
            call.respond(UserResponse(u.id, u.displayName, u.avatarColor, u.locale, member.membership.role.wire))
        }
        patch("/me") {
            val member = Guards.requireMember(call.requestAuth())
            val body = call.receive<UserPatchBody>()
            val u = users.update(member.session.userId, body.displayName, body.avatarColor, body.locale)
            call.respond(UserResponse(u.id, u.displayName, u.avatarColor, u.locale, member.membership.role.wire))
        }
        get("/me/preferences") {
            val member = Guards.requireMember(call.requestAuth())
            call.respond(users.getPreferences(member.session.userId))
        }
        patch("/me/preferences") {
            val member = Guards.requireMember(call.requestAuth())
            val body = call.receive<PreferencesPatchBody>()
            // distinguish absent vs explicit null not fully modeled; treat provided fields as updates
            val qProvided = body.quietHours != null || body.quietHoursSetNull
            val exProvided = body.extra != null || body.extraSetNull
            val out = users.updatePreferences(
                member.session.userId,
                body.quietHours,
                qProvided,
                body.pushEnabled,
                body.extra,
                exProvided,
            )
            call.respond(out)
        }

        get("/me/push-subscriptions") {
            val member = Guards.requireMember(call.requestAuth())
            val devices = push.list(member.session.userId).map { PushDeviceView(it.id, it.platform, it.label, it.createdAt, it.lastUsedAt) }
            call.respond(PushListResponse(push.platforms(), push.vapidPublicKey(), devices))
        }
        post("/me/push-subscriptions") {
            val member = Guards.requireMember(call.requestAuth())
            val body = call.receive<PushRegisterBody>()
            val d = when (body.platform) {
                "webpush" -> push.registerWebPush(member.session.userId, body.token, body.keys ?: PushKeys("", ""), body.label)
                "fcm" -> push.registerFcm(member.session.userId, body.token, body.label)
                else -> throw alice.core.error.validationError("Unknown platform")
            }
            call.respond(PushDeviceView(d.id, d.platform, d.label, d.createdAt, d.lastUsedAt))
        }
        delete("/me/push-subscriptions/{id}") {
            val member = Guards.requireMember(call.requestAuth())
            val id = call.parameters["id"] ?: ""
            push.unregister(member.session.userId, id)
            call.respond(mapOf("ok" to true))
        }
        post("/me/push-subscriptions/test") {
            val member = Guards.requireMember(call.requestAuth())
            val out = kotlinx.coroutines.runBlocking { push.sendTest(member.session.userId) }
            call.respond(out)
        }
    }
}

@Serializable data class UserResponse(val id: String, val displayName: String, val avatarColor: Long, val locale: String, val role: String)
@Serializable data class UserPatchBody(val displayName: String? = null, val avatarColor: Long? = null, val locale: String? = null)
@Serializable data class PreferencesPatchBody(
    val quietHours: QuietHours? = null,
    val pushEnabled: Boolean? = null,
    val extra: JsonObject? = null,
    // internal hints not from wire; clients send null explicitly in TS but kotlinx serialization handling differs - best effort
    val quietHoursSetNull: Boolean = false,
    val extraSetNull: Boolean = false,
)
@Serializable data class PushRegisterBody(val platform: String, val token: String, val keys: PushKeys? = null, val label: String? = null)
@Serializable data class PushDeviceView(val id: String, val platform: String, val label: String?, val createdAt: Long, val lastUsedAt: Long?)
@Serializable data class PushListResponse(val platforms: List<String>, val vapidPublicKey: String?, val devices: List<PushDeviceView>)
