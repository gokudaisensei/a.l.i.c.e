package alice.server.routes

import alice.server.http.Guards
import alice.server.http.requestAuth
import alice.server.permissions.NewDevicePolicy
import alice.server.permissions.Permission
import alice.server.permissions.PermissionService
import alice.server.permissions.ReplaceResult
import alice.server.permissions.permissionsFor
import io.ktor.server.application.ApplicationCall
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.route
import kotlinx.serialization.Serializable

fun Route.permissionRoutes(permissions: PermissionService) {
    route("/api/v1/permissions") {
        get("/me") {
            val member = Guards.requireMember(call.requestAuth())
            call.respond(MeResponse(member.membership.role.wire, member.membership.expiresAt, permissionsFor(member.membership.role).map { it.wire }))
        }
        get("/policies") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            call.respond(PoliciesResponse(permissions.listPolicies(member.membership.householdId)))
        }
        post("/policies") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<PolicyBody>()
            val created = permissions.createPolicy(
                member.membership.householdId,
                member.session.userId,
                NewDevicePolicy(body.connectionId, body.entityId, body.subjectType, body.subjectId, body.effect, body.operations),
            )
            call.respond(created)
        }
        delete("/policies/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Policy id is required")
            permissions.deletePolicy(member.membership.householdId, member.session.userId, id)
            call.respond(OkResponse())
        }
    }
}

fun Route.adminSecurityRoutes(permissions: PermissionService) {
    route("/api/v1/admin/security") {
        get("/sensitive-operations") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            call.respond(SensitiveOpsResponse(permissions.effectiveSensitivity(member.membership.householdId)))
        }
        put("/sensitive-operations") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val body = call.receive<SensitiveOpsBody>()
            val result = permissions.replaceSensitivityRules(
                member.membership.householdId,
                member.session.userId,
                body.rules.map { alice.server.permissions.SensitiveRule(it.domain, it.action, it.deviceClass ?: "", it.sensitive) },
            )
            call.respond(SensitiveOpsReplaceResponse(result.rules, result.defaultsSwitchedOff))
        }
        delete("/sensitive-operations/{id}") {
            val member = Guards.requirePermission(call.requestAuth(), Permission.SECURITY_MANAGE.wire)
            Guards.requireStepUp(member.session)
            val id = call.parameters["id"] ?: throw alice.core.error.validationError("Rule id is required")
            permissions.deleteSensitivityRule(member.membership.householdId, member.session.userId, id)
            call.respond(OkResponse())
        }
    }
}

@Serializable data class MeResponse(val role: String, val expiresAt: Long?, val permissions: List<String>)
@Serializable data class PoliciesResponse(val policies: List<alice.server.permissions.DevicePolicyRow>)
@Serializable data class PolicyBody(val connectionId: String, val entityId: String, val subjectType: String, val subjectId: String, val effect: String, val operations: List<String>? = null)
@Serializable data class SensitiveOpsResponse(val rules: List<alice.server.permissions.EffectiveSensitivityRule>)
@Serializable data class SensitiveRuleBody(val domain: String, val action: String, val deviceClass: String? = null, val sensitive: Boolean)
@Serializable data class SensitiveOpsBody(val rules: List<SensitiveRuleBody>)
@Serializable data class SensitiveOpsReplaceResponse(val rules: List<alice.server.permissions.EffectiveSensitivityRule>, val defaultsSwitchedOff: List<String>)
