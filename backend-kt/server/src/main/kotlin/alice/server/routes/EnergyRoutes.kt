package alice.server.routes

import alice.server.energy.EnergyService
import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.Permission
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.get
import io.ktor.server.routing.route

fun Route.energyRoutes(energy: EnergyService) {
    route("/api/v1/energy") {
        get("/summary") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ENERGY_VIEW.wire)
            call.respond(energy.summary(alice.server.things.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)))
        }
        get("/history") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ENERGY_VIEW.wire)
            val q = call.request.queryParameters
            call.respond(energy.history(alice.server.things.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp), q["from"], q["to"], q["resolution"]))
        }
        get("/pattern") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ENERGY_VIEW.wire)
            call.respond(mapOf("pattern" to energy.pattern(alice.server.things.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp))))
        }
        get("/devices") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.ENERGY_VIEW.wire)
            call.respond(energy.deviceList(alice.server.things.Caller(member.membership.householdId, member.session.userId, member.membership.role, member.session.steppedUp)))
        }
    }
}
