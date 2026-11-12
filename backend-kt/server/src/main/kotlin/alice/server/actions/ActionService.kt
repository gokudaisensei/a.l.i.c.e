package alice.server.actions

import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.ha.CapabilityDetector
import alice.server.commands.CommandExecutor
import alice.server.commands.CommandInput
import alice.server.commands.DeviceCommand
import alice.server.commands.Actor
import alice.server.commands.CommandSource
import alice.server.commands.validateParameters
import alice.server.permissions.evaluateDeviceAccess
import alice.server.permissions.AccessRequest
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ActionSpec(
    val entityId: String,
    val action: String,
    val parameters: Map<String, JsonElement> = emptyMap(),
)

@Serializable
data class SkippedAction(val action: ActionSpec, val reason: String)

class ActionService(
    private val things: ThingsService,
    private val permissions: alice.server.permissions.PermissionService,
    private val executor: CommandExecutor,
) {
    private suspend fun canSee(c: Caller, connectionId: String, entityId: String): Boolean {
        val found = things.findEntity(c.householdId, entityId)
        val targets = if (found != null) things.policyTargetsFor(entityId, found.thing) else setOf(entityId, "entity:$entityId")
        val policies = permissions.listPolicies(c.householdId).filter { it.connectionId == connectionId && it.entityId in targets }
        return evaluateDeviceAccess(AccessRequest(
            role = c.role, userId = c.userId, connectionId = connectionId, entityId = entityId, policies = policies, targetIds = targets,
        )).allowed
    }

    suspend fun canSee(c: Caller, connectionId: String, entityId: String, thing: alice.ha.Thing? = null): Boolean {
        val targets = things.policyTargetsFor(entityId, thing ?: things.findEntity(c.householdId, entityId)?.thing)
        val policies = permissions.listPolicies(c.householdId).filter { it.connectionId == connectionId && it.entityId in targets }
        return evaluateDeviceAccess(AccessRequest(
            role = c.role, userId = c.userId, connectionId = connectionId, entityId = entityId, policies = policies, targetIds = targets,
        )).allowed
    }

    suspend fun canSeeEntity(c: Caller, entityId: String): Boolean {
        val found = things.findEntity(c.householdId, entityId) ?: return false
        return canSee(c, found.connectionId, entityId, found.thing)
    }

    suspend fun validate(c: Caller, a: ActionSpec) {
        val found = things.findEntity(c.householdId, a.entityId)
            ?: throw AppException(ErrorCode.NOT_FOUND, "No such device entity: ${a.entityId}", 404)
        if (!canSee(c, found.connectionId, a.entityId)) throw AppException(ErrorCode.NOT_FOUND, "No such device entity: ${a.entityId}", 404)
        val entity = found.entity
        if (!CapabilityDetector.supportsOperation(entity.capabilities, a.action)) throw AppException(ErrorCode.VALIDATION_ERROR, "${a.entityId} does not support \"${a.action}\"", 400)
        val paramsMap: Map<String, Any?> = a.parameters.mapValues { (_, v) -> v as Any? }
        val bad = validateParameters(a.action, paramsMap)
        if (bad != null) throw AppException(ErrorCode.VALIDATION_ERROR, bad, 400)
        if (!c.steppedUp && permissions.sensitivityPolicy()(c.householdId, entity.domain, a.action, entity.deviceClass)) {
            throw AppException(ErrorCode.FORBIDDEN, "\"${a.action}\" on ${a.entityId} needs a fresh passkey confirmation", 403)
        }
    }

    /** Whether running [action] on [entityId] needs a fresh passkey, by the household's rules. */
    suspend fun isSensitive(householdId: String, entityId: String, action: String): Boolean {
        val entity = things.findEntity(householdId, entityId)?.entity
        return permissions.sensitivityPolicy()(householdId, entity?.domain ?: entityId.substringBefore('.'), action, entity?.deviceClass)
    }

    suspend fun run(c: Caller, actions: List<ActionSpec>): Pair<List<DeviceCommand>, List<SkippedAction>> {
        val commands = mutableListOf<DeviceCommand>()
        val skipped = mutableListOf<SkippedAction>()
        for (a in actions) {
            val found = things.findEntity(c.householdId, a.entityId)
            if (found == null) { skipped.add(SkippedAction(a, "That device no longer exists")); continue }
            if (!canSee(c, found.connectionId, a.entityId)) { skipped.add(SkippedAction(a, "Not available to you")); continue }
            val cmd = executor.execute(CommandInput(
                householdId = c.householdId,
                entityId = a.entityId,
                action = a.action,
                parameters = a.parameters,
                actor = Actor(c.userId, CommandSource.USER, c.steppedUp),
            ))
            commands.add(cmd)
        }
        return commands to skipped
    }

    suspend fun touchesVisible(c: Caller, actions: List<ActionSpec>): Boolean {
        for (a in actions) {
            val found = things.findEntity(c.householdId, a.entityId) ?: continue
            if (canSee(c, found.connectionId, a.entityId)) return true
        }
        return false
    }
}
