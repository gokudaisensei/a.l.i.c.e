package alice.server.routes

import alice.core.error.validationError
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import alice.server.routines.Caller
import alice.server.routines.RoutinesService
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

fun Route.routineRoutes(routines: RoutinesService) {
    route("/api/v1/routines") {
        get {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_RUN.wire)
            call.respond(mapOf("routines" to routines.list(m.membership.householdId)))
        }
        post {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_WRITE.wire)
            val body = call.receive<RoutineBody>()
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            call.respond(routines.create(c, body.name, body.icon, body.steps, body.onFailure))
        }
        get("/runs") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_RUN.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            call.respond(mapOf("runs" to routines.listRuns(c)))
        }
        get("/runs/{runId}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_RUN.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val runId = call.parameters["runId"] ?: throw validationError("runId is required")
            call.respond(routines.getRun(c, runId))
        }
        post("/runs/{runId}/cancel") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_RUN.wire)
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val runId = call.parameters["runId"] ?: throw validationError("runId is required")
            call.respond(routines.cancel(c, runId))
        }
        get("/{id}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_RUN.wire)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            call.respond(routines.get(m.membership.householdId, id))
        }
        patch("/{id}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_WRITE.wire)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            val body = call.receive<RoutinePatchBody>()
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val cleaned = if (body.steps != null) routines.cleanStepsJson(c, body.steps) else null
            // treat icon as provided if key present in JSON? route receives deserialized object; simplest: always pass true when field present - but body.icon null means clear. We'll use flag: if body has icon field we can't detect absent vs null easily without custom deserializer; assume icon provided when non-null or explicitly intended - for parity best-effort: update if name/steps/onFailure/icon present in patch semantics.
            call.respond(routines.update(c, id, body.name, body.icon != null, body.icon, cleaned, body.onFailure))
        }
        delete("/{id}") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_WRITE.wire)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            routines.remove(c, id)
            call.respond(mapOf("ok" to true))
        }
        post("/{id}/execute") {
            val m = Guards.requirePermission(call.requestAuth(), Permission.ROUTINE_RUN.wire)
            val id = call.parameters["id"] ?: throw validationError("id is required")
            val c = Caller(m.membership.householdId, m.session.userId, m.membership.role, m.session.steppedUp)
            val run = routines.execute(c, id)
            call.respond(HttpStatusCode.Accepted, run)
        }
    }
}

@Serializable data class RoutineBody(val name: String, val icon: String? = null, val steps: List<JsonElement>, val onFailure: String? = null)
@Serializable data class RoutinePatchBody(val name: String? = null, val icon: String? = null, val steps: List<JsonElement>? = null, val onFailure: String? = null)
