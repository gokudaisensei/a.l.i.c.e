package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class StateNormalizerTest {
    @Test
    fun `light normalizes brightness to percent`() {
        val n = StateNormalizer.normalize("light", "on", mapOf("brightness" to JsonPrimitive(128)))
        assertEquals(true, n["power"])
        assertTrue((n["brightness"] as Int) in 49..51)
    }

    @Test
    fun `unavailable returns empty`() {
        assertEquals(emptyMap<String, Any?>(), StateNormalizer.normalize("light", "unavailable", emptyMap()))
    }

    @Test
    fun `switch normalizes power`() {
        assertEquals(mapOf("power" to true), StateNormalizer.normalize("switch", "on", emptyMap()))
        assertEquals(mapOf("power" to false), StateNormalizer.normalize("switch", "off", emptyMap()))
    }

    @Test
    fun `climate normalizes hvac mode`() {
        val n = StateNormalizer.normalize("climate", "cool", mapOf("temperature" to JsonPrimitive(22.0), "current_temperature" to JsonPrimitive(24.0)))
        assertEquals("cool", n["hvac_mode"])
        assertEquals(22.0, n["target_temperature"])
        assertEquals(24.0, n["temperature"])
    }
}
