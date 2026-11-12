package alice.ha

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Test

class GoldenStateNormalizerTest {
    private fun renderAny(v: Any?): String = when (v) {
        null -> "null"
        is Map<*, *> -> v.entries.sortedBy { it.key.toString() }.joinToString(",", "{", "}") { "${it.key}=${renderAny(it.value)}" }
        is Iterable<*> -> v.joinToString(",", "[", "]") { renderAny(it) }
        else -> v.toString()
    }

    @Test
    fun `state normalizer output is pinned for every handled domain`() {
        val lightAttrs = mapOf(
            "brightness" to JsonPrimitive(127),
            "color_temp_kelvin" to JsonPrimitive(3000),
            "color_mode" to JsonPrimitive("hs"),
            "rgb_color" to JsonArray(listOf(JsonPrimitive(10), JsonPrimitive(20), JsonPrimitive(30))),
        )
        val cases = listOf(
            Triple("light", "on", lightAttrs),
            Triple("light", "off", lightAttrs),
            Triple("switch", "on", emptyMap()),
            Triple("input_boolean", "off", emptyMap()),
            Triple("fan", "on", mapOf("percentage" to JsonPrimitive(40), "oscillating" to JsonPrimitive(true), "direction" to JsonPrimitive("forward"), "preset_mode" to JsonPrimitive("auto"))),
            Triple("climate", "heat", mapOf("temperature" to JsonPrimitive(21.5), "current_temperature" to JsonPrimitive(20.0), "fan_mode" to JsonPrimitive("low"), "preset_mode" to JsonPrimitive("eco"), "swing_mode" to JsonPrimitive("on"), "hvac_action" to JsonPrimitive("heating"))),
            Triple("cover", "open", mapOf("current_position" to JsonPrimitive(35))),
            Triple("lock", "locked", emptyMap()),
            Triple("lock", "jammed", emptyMap()),
            Triple("media_player", "playing", emptyMap()),
            Triple("media_player", "standby", emptyMap()),
            Triple("input_number", "12.5", emptyMap()),
            Triple("number", "7", emptyMap()),
            Triple("sensor", "12.5", mapOf("unit_of_measurement" to JsonPrimitive("W"), "device_class" to JsonPrimitive("power"))),
            Triple("sensor", "hello", mapOf("unit_of_measurement" to JsonPrimitive("text"))),
            Triple("binary_sensor", "on", mapOf("device_class" to JsonPrimitive("door"))),
            Triple("camera", "idle", emptyMap()),
            Triple("update", "on", mapOf("installed_version" to JsonPrimitive("1.0"), "latest_version" to JsonPrimitive("1.1"))),
            Triple("vacuum", "docked", mapOf("battery_level" to JsonPrimitive(88))),
            Triple("humidifier", "on", mapOf("humidity" to JsonPrimitive(45))),
            Triple("water_heater", "eco", mapOf("temperature" to JsonPrimitive(50))),
            Triple("valve", "open", mapOf("current_position" to JsonPrimitive(80))),
            Triple("alarm_control_panel", "armed_away", emptyMap()),
            Triple("unknown_domain", "on", emptyMap()),
            Triple("light", "unavailable", lightAttrs),
            Triple("sensor", "unknown", emptyMap()),
        )
        val out = StringBuilder()
        for ((domain, state, attrs) in cases) {
            out.append(domain).append('|').append(state).append('=')
                .append(renderAny(StateNormalizer.normalize(domain, state, attrs))).append('\n')
        }
        GoldenSupport.assertGolden("states.txt", out.toString())
    }
}
