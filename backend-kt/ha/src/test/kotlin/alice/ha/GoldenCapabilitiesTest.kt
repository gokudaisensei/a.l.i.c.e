package alice.ha

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Test

class GoldenCapabilitiesTest {
    private fun renderAny(v: Any?): String = when (v) {
        null -> "null"
        is Map<*, *> -> v.entries.sortedBy { it.key.toString() }.joinToString(",", "{", "}") { "${it.key}=${renderAny(it.value)}" }
        is Iterable<*> -> v.joinToString(",", "[", "]") { renderAny(it) }
        else -> v.toString()
    }

    private fun render(caps: List<DeviceCapability>): String = caps.joinToString("|") { c ->
        "${c.name}:${c.readable}:${c.controllable}:${c.operations.joinToString(",")}:" +
            c.metadata.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${renderAny(it.value)}" }
    }

    @Test
    fun `capability output is pinned for every known domain and feature bit`() {
        val domains = listOf(
            "light", "switch", "input_boolean", "fan", "climate", "cover", "lock", "scene",
            "script", "input_number", "number", "media_player", "sensor", "binary_sensor", "camera", "unknown_domain",
        )
        val features = listOf(0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65535)
        val out = StringBuilder()
        for (domain in domains) {
            for (f in features) {
                val attrs = mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
                    "supported_features" to JsonPrimitive(f),
                )
                when (domain) {
                    "light" -> {
                        attrs["supported_color_modes"] = JsonArray(listOf(JsonPrimitive("color_temp"), JsonPrimitive("hs")))
                        attrs["min_color_temp_kelvin"] = JsonPrimitive(2000)
                        attrs["max_color_temp_kelvin"] = JsonPrimitive(6500)
                    }
                    "climate" -> attrs["hvac_modes"] = JsonArray(listOf(JsonPrimitive("heat"), JsonPrimitive("cool")))
                    "input_number", "number" -> {
                        attrs["min"] = JsonPrimitive(0)
                        attrs["max"] = JsonPrimitive(100)
                        attrs["step"] = JsonPrimitive(1)
                    }
                    "sensor" -> {
                        attrs["device_class"] = JsonPrimitive("power")
                        attrs["unit_of_measurement"] = JsonPrimitive("W")
                    }
                    "binary_sensor" -> attrs["device_class"] = JsonPrimitive("door")
                }
                out.append(domain).append(' ').append(f).append('=').append(render(CapabilityDetector.detect(CapabilitySource("$domain.test", domain, attrs)))).append('\n')
            }
        }
        GoldenSupport.assertGolden("capabilities.txt", out.toString())
    }
}
