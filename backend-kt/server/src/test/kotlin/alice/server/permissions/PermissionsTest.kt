package alice.server.permissions

import alice.server.households.Role
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PermissionsTest {
    @Test
    fun `admins have every permission, guests only the base set`() {
        assertTrue(can(Role.ADMIN, Permission.SECURITY_MANAGE))
        assertTrue(can(Role.MEMBER, Permission.DEVICE_CONTROL))
        assertFalse(can(Role.GUEST, Permission.MEMBERS_MANAGE))
        assertTrue(can(Role.GUEST, Permission.SCENE_RUN))
    }

    @Test
    fun `device access denies guests without an allow and honours denies`() {
        val guest = evaluateDeviceAccess(
            AccessRequest(
                role = Role.GUEST,
                userId = "u",
                connectionId = "c",
                entityId = "light.x",
                policies = listOf(DevicePolicyRow("p", "h", "c", "light.x", "role", "guest", "allow", null)),
            ),
        )
        assertTrue(guest.allowed)

        val denied = evaluateDeviceAccess(
            AccessRequest(
                role = Role.MEMBER,
                userId = "u",
                connectionId = "c",
                entityId = "light.x",
                policies = listOf(DevicePolicyRow("p", "h", "c", "light.x", "role", "member", "deny", null)),
            ),
        )
        assertFalse(denied.allowed)
    }
}
