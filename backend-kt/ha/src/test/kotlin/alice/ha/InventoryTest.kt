package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class InventoryTest {
    @Test
    fun `resolves area via device, drops disabled hidden, derives capabilities and names`() {
        val inv = buildInventory(RawDiscovery(
            areas = listOf(HaAreaRegistryEntry("living", "Living room")),
            devices = listOf(
                HaDeviceRegistryEntry(id = "d1", name = "Hue lamp", area_id = "living", manufacturer = "Signify", model = "A60"),
                HaDeviceRegistryEntry(id = "d2", name = "Old", disabled_by = "user"),
            ),
            entityRegistry = listOf(
                HaEntityRegistryEntry(entity_id = "light.lamp", device_id = "d1", platform = "hue"),
                HaEntityRegistryEntry(entity_id = "light.hidden", device_id = null, platform = "hue", hidden_by = "user"),
                HaEntityRegistryEntry(entity_id = "switch.override", device_id = "d1", platform = "x", area_id = "kitchen"),
            ),
            states = listOf(
                HaEntityState("light.lamp", "on", mapOf("friendly_name" to JsonPrimitive("Floor lamp"), "supported_color_modes" to kotlinx.serialization.json.JsonArray(listOf(JsonPrimitive("brightness"))))),
                HaEntityState("light.hidden", "on"),
                HaEntityState("switch.override", "off"),
                HaEntityState("sensor.orphan", "5"),
            ),
        ))
        val byId = inv.entities.associateBy { it.entityId }
        assertEquals(listOf("light.lamp", "sensor.orphan", "switch.override"), byId.keys.sorted())
        assertEquals("Floor lamp", byId["light.lamp"]?.name)
        assertEquals("living", byId["light.lamp"]?.areaId)
        assertEquals("d1", byId["light.lamp"]?.deviceId)
        assertEquals(listOf("power", "brightness"), byId["light.lamp"]?.capabilities?.map { it.name })
        assertEquals("kitchen", byId["switch.override"]?.areaId)
        assertEquals(null, byId["sensor.orphan"]?.areaId)
        assertEquals(listOf("d1"), inv.devices.map { it.deviceId })
    }
}
