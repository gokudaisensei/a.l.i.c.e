package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class StateCacheTest {
    @Test
    fun `replaceAll populates cache`() {
        val cache = StateCache()
        cache.replaceAll(listOf(HaEntityState("light.x", "on", mapOf("brightness" to JsonPrimitive(255)))))
        assertEquals(1, cache.size)
        assertEquals("on", cache.get("light.x")?.state)
        assertEquals(100, cache.get("light.x")?.normalized?.get("brightness"))
    }

    @Test
    fun `apply updates single entity`() {
        val cache = StateCache()
        cache.replaceAll(listOf(HaEntityState("light.x", "on")))
        cache.apply(HaEntityState("light.x", "off"), "light.x")
        assertEquals("off", cache.get("light.x")?.state)
    }

    @Test
    fun `apply with null removes entity`() {
        val cache = StateCache()
        cache.replaceAll(listOf(HaEntityState("light.x", "on")))
        cache.apply(null, "light.x")
        assertNull(cache.get("light.x"))
        assertEquals(0, cache.size)
    }

    @Test
    fun `list filters correctly`() {
        val cache = StateCache()
        cache.replaceAll(listOf(HaEntityState("light.x", "on"), HaEntityState("switch.y", "off")))
        val lights = cache.list { it.domain == "light" }
        assertEquals(1, lights.size)
        assertEquals("light.x", lights[0].entityId)
    }
}
