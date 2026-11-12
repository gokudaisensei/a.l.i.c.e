package alice.ha

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Test
import kotlin.test.assertTrue

class GoldenThingsTest {
    private fun renderAny(v: Any?): String = when (v) {
        null -> "null"
        is Map<*, *> -> v.entries.sortedBy { it.key.toString() }.joinToString(",", "{", "}") { "${it.key}=${renderAny(it.value)}" }
        is Iterable<*> -> v.joinToString(",", "[", "]") { renderAny(it) }
        else -> v.toString()
    }

    private fun renderEntity(e: ThingEntity): String = buildString {
        append("entity(")
        append("id=${e.entityId};domain=${e.domain};name=${e.name};role=${e.role};deviceClass=${e.deviceClass};")
        append("roleReason=${e.roleReason};key=${e.key};attachedTo=${e.attachedTo};caps=[")
        append(e.capabilities.joinToString(",") { c ->
            "${c.name}:${c.readable}:${c.controllable}:${c.operations.joinToString("|")}:${c.metadata.entries.sortedBy { it.key }.joinToString("|") { "${it.key}=${renderAny(it.value)}" }}"
        })
        append("])")
    }

    private fun renderThing(t: Thing): String = buildString {
        append("thing(")
        append("id=${t.id};ref=${t.ref};kind=${t.kind};name=${t.name};nameSource=${t.nameSource};sourceName=${t.sourceName};")
        append("areaId=${t.areaId};hidden=${t.hidden};hubThingId=${t.hubThingId};deviceIds=${t.deviceIds.joinToString("|")};")
        append("aliases=${t.aliases.joinToString("|")};manufacturer=${t.manufacturer};model=${t.model};entityIds=${t.entityIds.joinToString("|")};")
        append("primary=${t.primary?.let(::renderEntity)};others=${t.others.joinToString("||") { renderEntity(it) }};")
        append("controls=${t.controls.joinToString("||") { renderEntity(it) }};facets=${t.facets.joinToString("||") { renderEntity(it) }};")
        append("sensors=${t.sensors.joinToString("||") { renderEntity(it) }};diagnostics=${t.diagnostics.joinToString("||") { renderEntity(it) }}")
        append(")")
    }

    private fun renderThings(things: List<Thing>): String = things.joinToString("\n") { renderThing(it) }

    @Test
    fun `home fixture output is pinned`() {
        val actual = renderThings(ThingBuilder.buildThings(homeInventory(), "conn-1", ThingBuilder.ThingOverrides()))
        GoldenSupport.assertGolden("things-home.txt", actual)
    }

    @Test
    fun `large synthetic home output is pinned`() {
        val domains = listOf("light", "switch", "sensor", "binary_sensor", "climate", "fan", "cover", "lock", "media_player", "number")
        val states = mapOf(
            "light" to "on", "switch" to "off", "sensor" to "42", "binary_sensor" to "off",
            "climate" to "heat", "fan" to "on", "cover" to "open", "lock" to "locked",
            "media_player" to "idle", "number" to "5",
        )
        val areas = (0 until 10).map { HaAreaRegistryEntry("area$it", "Area $it") }
        val devices = mutableListOf<HaDeviceRegistryEntry>()
        for (h in 0 until 5) {
            devices.add(HaDeviceRegistryEntry("hub$h", "Hub $h", area_id = "area$h", manufacturer = "HubCo", identifiers = listOf(listOf("hub", "$h"))))
        }
        for (i in 0..319) {
            val area = "area${i % 10}"
            devices.add(
                HaDeviceRegistryEntry(
                    id = "d$i",
                    name = if (i % 7 == 0) "Area ${i % 10} Device $i 2" else "Device $i",
                    area_id = area,
                    via_device_id = "hub${i % 5}",
                    manufacturer = "Maker ${i % 4}",
                    model = "Model ${i % 6}",
                    identifiers = listOf(listOf("syn", "$i")),
                ),
            )
        }
        val entityRegistry = mutableListOf<HaEntityRegistryEntry>()
        val stateList = mutableListOf<HaEntityState>()
        fun entityId(i: Int): String = "${domains[i % domains.size]}.d$i"
        for (i in 0..319) {
            val domain = domains[i % domains.size]
            val id = entityId(i)
            entityRegistry.add(HaEntityRegistryEntry(entity_id = id, device_id = "d$i", platform = domain, original_name = "Device $i", has_entity_name = true))
            val attrs = when (domain) {
                "light" -> mapOf("friendly_name" to JsonPrimitive("Device $i"), "supported_color_modes" to JsonArray(listOf(JsonPrimitive("brightness"))), "brightness" to JsonPrimitive((i % 255)))
                "fan" -> mapOf("friendly_name" to JsonPrimitive("Device $i"), "supported_features" to JsonPrimitive(1 or 2 or 4 or 8))
                "climate" -> mapOf("friendly_name" to JsonPrimitive("Device $i"), "hvac_modes" to JsonArray(listOf(JsonPrimitive("heat"))), "supported_features" to JsonPrimitive(1 or 8 or 16 or 32))
                "cover" -> mapOf("friendly_name" to JsonPrimitive("Device $i"), "supported_features" to JsonPrimitive(1 or 2 or 4 or 8))
                "lock" -> mapOf("friendly_name" to JsonPrimitive("Device $i"), "supported_features" to JsonPrimitive(1))
                "sensor" -> mapOf("friendly_name" to JsonPrimitive("Device $i"), "unit_of_measurement" to JsonPrimitive("W"))
                else -> mapOf("friendly_name" to JsonPrimitive("Device $i"))
            }
            stateList.add(HaEntityState(id, states[domain] ?: "on", attrs))
        }
        // Hubs with an entity, plus hubs without entities (they still get things because children hang off them).
        for (h in 0..1) {
            val id = "sensor.hub$h"
            entityRegistry.add(HaEntityRegistryEntry(entity_id = id, device_id = "hub$h", platform = "sensor", original_name = "Hub $h", has_entity_name = true))
            stateList.add(HaEntityState(id, "1", mapOf("friendly_name" to JsonPrimitive("Hub $h"))))
        }
        // Loose entities with no device.
        for (i in 0..2) {
            val id = listOf("input_boolean.loose$i", "sensor.loose$i", "script.loose$i")[i]
            entityRegistry.add(HaEntityRegistryEntry(entity_id = id, device_id = null, platform = id.substringBefore('.'), original_name = "Loose $i", has_entity_name = true))
            stateList.add(HaEntityState(id, "off", mapOf("friendly_name" to JsonPrimitive("Loose $i"))))
        }
        val raw = RawDiscovery(
            areas = areas,
            devices = devices,
            entityRegistry = entityRegistry,
            states = stateList,
        )
        val inv = buildInventory(raw, at = "2026-01-01T00:00:00Z")
        assertTrue(inv.devices.size >= 300)
        val splitEntity = entityId(12)
        val ov = ThingBuilder.ThingOverrides(
            things = mapOf(
                "device:d3" to ThingBuilder.ThingOverride(displayName = "Override three", hidden = false),
                "device:d7" to ThingBuilder.ThingOverride(hidden = true),
                "device:d9" to ThingBuilder.ThingOverride(areaId = "area0"),
            ),
            merges = listOf(listOf("device:d10", "device:d11")),
            splits = listOf(splitEntity),
        )
        val actual = renderThings(ThingBuilder.buildThings(inv, "conn-1", ov))
        GoldenSupport.assertGolden("things-large.txt", actual)
    }
}
