package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class CapabilityDetectorTest {
    @Test
    fun `light with color modes gets brightness color and color temperature`() {
        val caps = CapabilityDetector.detect(CapabilitySource("light.x", "light", mapOf("supported_color_modes" to kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("brightness"), JsonPrimitive("color_temp"), JsonPrimitive("hs"))))))
        val names = caps.map { it.name }
        assertTrue("brightness" in names)
        assertTrue("color_temperature" in names)
        assertTrue("color" in names)
    }

    @Test
    fun `resolveOperation maps set_brightness to turn_on with brightness_pct`() {
        val op = resolveOperation("light", "set_brightness", mapOf("brightness_pct" to 50))
        assertEquals("light", op?.domain)
        assertEquals("turn_on", op?.service)
        assertEquals(50, op?.data?.get("brightness_pct"))
    }

    @Test
    fun `unknown domain gets state capability`() {
        val caps = CapabilityDetector.detect(CapabilitySource("foo.bar", "foo", emptyMap()))
        assertEquals(listOf("state"), caps.map { it.name })
    }
}
