package alice.server.routes

import alice.server.ha.HaConnectionAdminService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.sync.ConfigSyncService
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

fun Route.haConnectionRoutes(service: HaConnectionAdminService, sync: ConfigSyncService? = null) {
    route("/api/v1/ha") {
        route("/connection") {
            get {
                val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
                call.respond(service.status(member.membership.householdId))
            }
            put {
                val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
                Guards.requireStepUp(member.session)
                val body = call.receive<HaConnectionBody>()
                call.respond(service.putConnection(member.membership.householdId, member.session.userId, body.name, body.baseUrl, body.token))
            }
            post("/test") {
                val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
                val result = service.testConnection(member.membership.householdId)
                call.respond(result.toJsonObject())
            }
            post("/resync") {
                val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
                Guards.requireStepUp(member.session)
                val result = service.resyncConnection(member.membership.householdId, member.session.userId, sync)
                call.respond(result.toJsonObject())
            }
            delete {
                val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
                Guards.requireStepUp(member.session)
                val result = service.deleteConnection(member.membership.householdId, member.session.userId)
                call.respond(result.toJsonObject())
            }
            put("/admin-token") {
                val member = Guards.requirePermission(call.requestAuth(), "ha.manage")
                Guards.requireStepUp(member.session)
                val body = call.receive<AdminTokenBody>()
                service.setAdminToken(member.membership.householdId, member.session.userId, body.token)
                call.respond(alice.server.routes.OkResponse())
            }
        }
    }
}

@Serializable data class AdminTokenBody(val token: String)
@Serializable data class HaConnectionBody(val name: String? = null, val baseUrl: String, val token: String? = null)
