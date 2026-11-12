package alice.server.routes

import alice.core.error.AppException
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import alice.server.support.OperatorHome
import alice.server.support.OperatorIdentity
import alice.server.support.OperatorService
import io.ktor.server.request.header
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

fun Route.operatorRoutes(operators: OperatorService) {
    route("/api/v1/operator") {
        get("/homes") {
            authOp(call.request.header("Authorization"), operators)
            call.respond(buildJsonObject {
                put("homes", Json.encodeToJsonElement(ListSerializer(OperatorHome.serializer()), operators.homes()))
            })
        }
        get("/homes/{id}/health") {
            val op = authOp(call.request.header("Authorization"), operators)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Household id is required")
            call.respond(operators.health(op, id))
        }
        get("/homes/{id}/devices") {
            val op = authOp(call.request.header("Authorization"), operators)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Household id is required")
            call.respond(operators.devicesOf(op, id))
        }
    }
}

@Serializable data class CreateOperatorBody(val label: String, val days: Int = 90)
@Serializable data class RevokeOperatorBody(val label: String)

fun Route.adminOperatorRoutes(operators: OperatorService) {
    route("/api/v1/admin/operators") {
        post {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<CreateOperatorBody>()
            val (op, token, expiresAt) = operators.create(body.label, body.days)
            call.respond(buildJsonObject {
                put("operator", Json.encodeToJsonElement(OperatorIdentity.serializer(), op))
                put("token", JsonPrimitive(token))
                put("expiresAt", JsonPrimitive(expiresAt))
            })
        }
        delete {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<RevokeOperatorBody>()
            operators.revoke(body.label)
            call.respond(buildJsonObject { put("revoked", JsonPrimitive(true)) })
        }
    }
}

private fun authOp(auth: String?, operators: OperatorService): OperatorIdentity {
    val h = auth ?: ""
    if (!h.startsWith("Bearer ")) throw AppException("unauthenticated", "Support sign-in failed", 401)
    return operators.authenticate(h.removePrefix("Bearer ").trim())
}
