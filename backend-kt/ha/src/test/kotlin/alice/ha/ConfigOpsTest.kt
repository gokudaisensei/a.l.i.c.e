package alice.ha

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ConfigOpsTest {
    @Test
    fun `validateOperation accepts valid script upsert`() {
        val op = mapOf("op" to "script.upsert", "objectId" to "alice_test", "config" to mapOf("alias" to "Test", "sequence" to listOf(mapOf("service" to "light.turn_on"))))
        ConfigOps.validateOperation(op)
    }

    @Test
    fun `validateOperation rejects invalid script id`() {
        val op = mapOf("op" to "script.upsert", "objectId" to "bad_id", "config" to mapOf("alias" to "Test", "sequence" to listOf(mapOf("service" to "light.turn_on"))))
        try {
            ConfigOps.validateOperation(op)
            assertTrue(false, "should have thrown")
        } catch (e: ConfigOps.ConfigOpError) {
            assertTrue(true)
        }
    }

    @Test
    fun `canonicalConfig sorts keys`() {
        val a = mapOf("b" to 1, "a" to 2)
        val b = mapOf("a" to 2, "b" to 1)
        assertEquals(ConfigOps.canonicalConfig(a), ConfigOps.canonicalConfig(b))
    }

    @Test
    fun `sameConfig compares canonical forms`() {
        assertTrue(ConfigOps.sameConfig(mapOf("a" to 1, "b" to 2), mapOf("b" to 2, "a" to 1)))
    }
}
