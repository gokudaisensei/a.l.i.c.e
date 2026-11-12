package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NormalizerTest {
    @Test
    fun `normalizeStateChanged produces entity state changed event`() {
        val ev = HaStateChangedEvent(
            entity_id = "light.x",
            old_state = HaEntityState("light.x", "off", emptyMap()),
            new_state = HaEntityState("light.x", "on", mapOf("brightness" to JsonPrimitive(255))),
            timeFired = "2026-01-01T00:00:00Z",
        )
        val events = Normalizer.normalizeStateChanged(EventScope("h1", "c1"), ev)
        assertEquals(1, events.size)
        assertEquals("entity.state_changed", events[0].type)
    }

    @Test
    fun `normalizeStateChanged with removed state produces entity removed`() {
        val ev = HaStateChangedEvent(
            entity_id = "light.x",
            old_state = HaEntityState("light.x", "on", emptyMap()),
            new_state = null,
            timeFired = "2026-01-01T00:00:00Z",
        )
        val events = Normalizer.normalizeStateChanged(EventScope("h1", "c1"), ev)
        assertEquals(1, events.size)
        assertEquals("entity.removed", events[0].type)
    }

    @Test
    fun `normalizeRegistryEvent produces registry updated`() {
        val ev = HaRawEvent("area_registry_updated", emptyMap(), "2026-01-01T00:00:00Z")
        val e = Normalizer.normalizeRegistryEvent(EventScope("h1", "c1"), ev)
        assertTrue(e != null)
        assertEquals("registry.updated", e!!.type)
    }
}
