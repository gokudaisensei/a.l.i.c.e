package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PresentationTest {
    @Test
    fun `presentThing returns null when primary is not visible`() {
        val thing = Thing(
            id = "t1", ref = "device:d1", kind = ThingKind.device, name = "Lamp", nameSource = "source",
            sourceName = "Lamp", areaId = null, hidden = false, primary = ThingEntity(
                "light.x", "light", "Lamp", EntityRole.primary, null, "light domain", emptyList()
            ),
            others = emptyList(), controls = emptyList(), facets = emptyList(), sensors = emptyList(),
            diagnostics = emptyList(), entityIds = listOf("light.x"), hubThingId = null,
            deviceIds = listOf("d1"), aliases = emptyList(), manufacturer = null, model = null,
        )
        val result = Presentation.presentThing(thing, { null }, { false })
        assertNull(result)
    }

    @Test
    fun `presentThing returns view when primary is visible`() {
        val thing = Thing(
            id = "t1", ref = "device:d1", kind = ThingKind.device, name = "Lamp", nameSource = "source",
            sourceName = "Lamp", areaId = null, hidden = false, primary = ThingEntity(
                "light.x", "light", "Lamp", EntityRole.primary, null, "light domain", emptyList()
            ),
            others = emptyList(), controls = emptyList(), facets = emptyList(), sensors = emptyList(),
            diagnostics = emptyList(), entityIds = listOf("light.x"), hubThingId = null,
            deviceIds = listOf("d1"), aliases = emptyList(), manufacturer = null, model = null,
        )
        val cache = StateCache()
        cache.replaceAll(listOf(HaEntityState("light.x", "on", mapOf("brightness" to JsonPrimitive(255)))))
        val result = Presentation.presentThing(thing, { cache.get(it) }, { true })
        assertNotNull(result)
        assertEquals("Lamp", result!!.name)
        assertEquals(true, result.available)
    }

    @Test
    fun `matchesQuery checks all words present`() {
        val thing = Thing(
            id = "t1", ref = "device:d1", kind = ThingKind.device, name = "Floor lamp", nameSource = "source",
            sourceName = "Floor lamp", areaId = null, hidden = false, primary = null,
            others = emptyList(), controls = emptyList(), facets = emptyList(), sensors = emptyList(),
            diagnostics = emptyList(), entityIds = emptyList(), hubThingId = null,
            deviceIds = emptyList(), aliases = listOf("living room floor lamp"), manufacturer = null, model = null,
        )
        assertTrue(Presentation.matchesQuery(thing, "floor lamp"))
        assertTrue(Presentation.matchesQuery(thing, "living lamp"))
        assertTrue(!Presentation.matchesQuery(thing, "ceiling lamp"))
    }
}
