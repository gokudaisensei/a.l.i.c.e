package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Test
import kotlin.system.measureTimeMillis
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ThingBuilderRobustnessTest {
    private fun inventory(devices: List<HaDeviceRegistryEntry>, entityRegistry: List<HaEntityRegistryEntry>, states: List<HaEntityState>): Inventory =
        buildInventory(RawDiscovery(areas = emptyList(), devices = devices, entityRegistry = entityRegistry, states = states), at = "2026-01-01T00:00:00Z")

    @Test
    fun `a twenty thousand device merge chain does not overflow the stack`() {
        val n = 20_000
        val devices = (0 until n).map { i ->
            HaDeviceRegistryEntry("d$i", "Device $i", identifiers = listOf(listOf("x", "$i")))
        }
        val registry = (0 until n).map { i ->
            HaEntityRegistryEntry("sensor.d$i", "d$i", "sensor", original_name = "Device $i", has_entity_name = true)
        }
        val states = (0 until n).map { i -> HaEntityState("sensor.d$i", "$i", mapOf("friendly_name" to JsonPrimitive("Device $i"))) }
        val merges = (1 until n).map { i -> listOf("device:d$i", "device:d${i - 1}") }
        val result = ThingBuilder.buildThings(inventory(devices, registry, states), "conn-1", ThingBuilder.ThingOverrides(merges = merges))
        assertEquals(1, result.size)
    }

    @Test
    fun `one thousand devices build quickly`() {
        val n = 1_000
        val devices = (0 until n).map { i -> HaDeviceRegistryEntry("d$i", "Device $i", area_id = "a${i % 10}", identifiers = listOf(listOf("x", "$i"))) }
        val registry = (0 until n).map { i -> HaEntityRegistryEntry("light.d$i", "d$i", "light", original_name = "Device $i", has_entity_name = true) }
        val states = (0 until n).map { i -> HaEntityState("light.d$i", "on", mapOf("friendly_name" to JsonPrimitive("Device $i"))) }
        val inv = inventory(devices, registry, states)
        val times = (1..5).map { measureTimeMillis { ThingBuilder.buildThings(inv, "conn-1") } }.sorted()
        println("THING_BUILD_MEDIAN_MS_1000=${times[2]} samples=$times")
        assertTrue(times[2] < 5_000, "median ${times[2]}ms")
    }

    @Test
    fun `twelve thousand devices on twelve thousand hubs do not scan quadratically`() {
        val n = 12_000
        val devices = mutableListOf<HaDeviceRegistryEntry>()
        for (i in 0 until n) devices.add(HaDeviceRegistryEntry("hub$i", "Hub $i"))
        for (i in 0 until n) devices.add(HaDeviceRegistryEntry("d$i", "Device $i", via_device_id = "hub$i"))
        val registry = (0 until n).map { i -> HaEntityRegistryEntry("light.d$i", "d$i", "light", original_name = "Device $i", has_entity_name = true) }
        val states = (0 until n).map { i -> HaEntityState("light.d$i", "on", mapOf("friendly_name" to JsonPrimitive("Device $i"))) }
        val inv = inventory(devices, registry, states)
        val elapsed = measureTimeMillis { ThingBuilder.buildThings(inv, "conn-1") }
        println("THING_BUILD_HUBS_12000_MS=$elapsed")
        assertTrue(elapsed < 4_000, "12000 hubs took ${elapsed}ms")
    }

    @Test
    fun `three thousand devices on three thousand hubs build quickly`() {
        val n = 3_000
        val devices = mutableListOf<HaDeviceRegistryEntry>()
        for (i in 0 until n) devices.add(HaDeviceRegistryEntry("hub$i", "Hub $i"))
        for (i in 0 until n) devices.add(HaDeviceRegistryEntry("d$i", "Device $i", via_device_id = "hub$i"))
        val registry = (0 until n).map { i -> HaEntityRegistryEntry("light.d$i", "d$i", "light", original_name = "Device $i", has_entity_name = true) }
        val states = (0 until n).map { i -> HaEntityState("light.d$i", "on", mapOf("friendly_name" to JsonPrimitive("Device $i"))) }
        val inv = inventory(devices, registry, states)
        val elapsed = measureTimeMillis { ThingBuilder.buildThings(inv, "conn-1") }
        println("THING_BUILD_HUBS_3000_MS=$elapsed")
        assertTrue(elapsed < 10_000, "3000 hubs took ${elapsed}ms")
    }
}
