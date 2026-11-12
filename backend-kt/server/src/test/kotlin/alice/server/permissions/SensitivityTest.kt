package alice.server.permissions

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SensitivityTest {
    private fun rule(domain: String, action: String, deviceClass: String, sensitive: Boolean) =
        SensitiveRule(domain, action, deviceClass, sensitive)

    @Test
    fun `by default only unlock and open on a lock need a passkey`() {
        assertTrue(resolveSensitivity(emptyList(), "lock", "unlock", null))
        assertTrue(resolveSensitivity(emptyList(), "lock", "open", null))
        assertFalse(resolveSensitivity(emptyList(), "lock", "lock", null))
        assertFalse(resolveSensitivity(emptyList(), "cover", "open", null))
        assertFalse(resolveSensitivity(emptyList(), "light", "turn_on", null))
    }

    @Test
    fun `household rules beat the defaults`() {
        assertFalse(resolveSensitivity(listOf(rule("lock", "unlock", "", false)), "lock", "unlock", null))
        assertTrue(resolveSensitivity(listOf(rule("cover", "open", "", true)), "cover", "open", null))
    }

    @Test
    fun `a device class rule beats a general one, whatever the order`() {
        val general = rule("cover", "open", "", true)
        val garage = rule("cover", "open", "garage", false)
        assertFalse(resolveSensitivity(listOf(general, garage), "cover", "open", "garage"))
        assertFalse(resolveSensitivity(listOf(garage, general), "cover", "open", "garage"))
        assertTrue(resolveSensitivity(listOf(garage, general), "cover", "open", "blind"))
    }

    @Test
    fun `matching ignores case`() {
        assertEquals(true, resolveSensitivity(emptyList(), "LOCK", "Unlock", null))
    }

    @Test
    fun `a guest with no allow rule is denied, with one is allowed`() {
        fun request(policies: List<DevicePolicyRow>) = AccessRequest(
            role = alice.server.households.Role.GUEST, userId = "u", connectionId = "c", entityId = "light.x", policies = policies,
        )
        assertFalse(evaluateDeviceAccess(request(emptyList())).allowed)
        val allow = DevicePolicyRow("p", "h", "c", "light.x", "role", "guest", "allow", null)
        assertTrue(evaluateDeviceAccess(request(listOf(allow))).allowed)
        val deny = allow.copy(id = "q", effect = "deny")
        assertFalse(evaluateDeviceAccess(request(listOf(allow, deny))).allowed)
    }
}
