package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.smart.OrderAckRequest
import alice.server.smart.SmartService
import alice.server.things.Caller
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route

fun Route.smartRoutes(smart: SmartService) {
    route("/api/v1/home") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val caller = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val res = smart.home(caller)
            val inm = call.request.headers[HttpHeaders.IfNoneMatch]
            if (inm != null && inm.trim('"') == res.generation.toString()) {
                call.respond(HttpStatusCode.NotModified)
                return@get
            }
            call.response.header(HttpHeaders.ETag, "\"${res.generation}\"")
            call.response.header(HttpHeaders.CacheControl, "private, max-age=5")
            call.respond(res)
        }
        get("/why") {
            val member = Guards.requireMember(call.requestAuth())
            val thingId = call.request.queryParameters["thingId"] ?: ""
            val action = call.request.queryParameters["action"] ?: ""
            call.respond(smart.why(member.membership.householdId, member.session.userId, thingId, action))
        }
        post("/order/ack") {
            Guards.requireMember(call.requestAuth())
            val body = runCatching { call.receive<OrderAckRequest>() }.getOrDefault(OrderAckRequest(0))
            call.respond(kotlinx.serialization.json.buildJsonObject {
                put("ack", kotlinx.serialization.json.JsonPrimitive(true))
                put("generation", kotlinx.serialization.json.JsonPrimitive(body.generation))
            })
        }
    }
    route("/api/v1/search") {
        get {
            val member = Guards.requireMember(call.requestAuth())
            val caller = Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)
            val q = call.request.queryParameters["q"]
            call.respond(smart.search(caller, q))
        }
    }
}
