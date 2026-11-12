package alice.server.permissions

import alice.server.households.Role

import kotlinx.serialization.Serializable

@Serializable
data class DevicePolicyRow(
    val id: String,
    val householdId: String,
    val connectionId: String,
    val entityId: String,
    val subjectType: String,
    val subjectId: String,
    val effect: String,
    val operations: List<String>?,
)

data class AccessRequest(
    val role: Role,
    val userId: String,
    val connectionId: String,
    val entityId: String,
    val operation: String? = null,
    val policies: List<DevicePolicyRow>,
    /** Additional policy target ids that refer to the same thing/device (e.g. device:<id>, thing ref). */
    val targetIds: Set<String> = emptySet(),
)

data class AccessResult(val allowed: Boolean, val reason: String)

/**
 * Device/thing-level access on top of role permissions. Admins and members may use
 * any device unless a matching deny exists. Guests may use only devices with a
 * matching allow. A deny always beats an allow.
 */
fun evaluateDeviceAccess(r: AccessRequest): AccessResult {
    val targets = if (r.targetIds.isEmpty()) setOf(r.entityId) else r.targetIds + r.entityId
    val matching = r.policies.filter { p ->
        p.connectionId == r.connectionId &&
            p.entityId in targets &&
            ((p.subjectType == "role" && p.subjectId == r.role.wire) ||
                (p.subjectType == "member" && p.subjectId == r.userId)) &&
            (r.operation == null || p.operations == null || r.operation in p.operations)
    }
    if (matching.any { it.effect == "deny" }) return AccessResult(false, "This device is blocked for you")
    if (r.role == Role.GUEST) {
        return if (matching.any { it.effect == "allow" }) AccessResult(true, "Allowed for guests")
        else AccessResult(false, "Guests can only use devices they have been given")
    }
    return AccessResult(true, "Allowed by role")
}
