package alice.ha

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

typealias NormalizedState = Map<String, Any?>

object StateNormalizer {
    fun normalize(domain: String, state: String, attributes: Map<String, JsonElement>): NormalizedState {
        if (state == "unavailable" || state == "unknown") return emptyMap()
        return when (domain) {
            "light" -> mapOf(
                "power" to (state == "on"),
                "brightness" to pct255(attributes["brightness"]),
                "color_temperature" to num(attributes["color_temp_kelvin"]),
                "color_mode" to str(attributes["color_mode"]),
                "color" to rgb(attributes["rgb_color"])?.let { mapOf("rgb" to it) },
            )
            "switch", "input_boolean" -> mapOf("power" to (state == "on"))
            "fan" -> mapOf(
                "power" to (state == "on"),
                "fan_speed" to num(attributes["percentage"]),
                "oscillation" to (attributes["oscillating"] as? JsonPrimitive)?.content?.toBooleanStrictOrNull(),
                "direction" to str(attributes["direction"]),
                "fan_preset" to str(attributes["preset_mode"]),
            )
            "climate" -> mapOf(
                "power" to (state != "off"),
                "hvac_mode" to state,
                "target_temperature" to num(attributes["temperature"]),
                "temperature" to num(attributes["current_temperature"]),
                "fan_mode" to str(attributes["fan_mode"]),
                "climate_preset" to str(attributes["preset_mode"]),
                "swing" to str(attributes["swing_mode"]),
                "hvac_action" to str(attributes["hvac_action"]),
            )
            "cover" -> mapOf("cover" to state, "position" to num(attributes["current_position"]))
            "lock" -> mapOf("lock" to state)
            "media_player" -> mapOf("power" to (state !in listOf("off", "standby")))
            "input_number", "number" -> mapOf("number" to numStr(state))
            "sensor" -> mapOf("sensor" to mapOf("value" to (numStr(state) ?: state), "unit" to str(attributes["unit_of_measurement"]), "deviceClass" to str(attributes["device_class"])))
            "binary_sensor" -> mapOf("binary_sensor" to (state == "on"), "device_class" to str(attributes["device_class"]))
            "camera" -> mapOf("camera" to state)
            "update" -> mapOf("update" to state, "installed_version" to str(attributes["installed_version"]), "latest_version" to str(attributes["latest_version"]))
            "vacuum" -> mapOf("vacuum" to state, "battery" to num(attributes["battery_level"]))
            "humidifier" -> mapOf("humidifier" to state, "humidity" to num(attributes["humidity"]))
            "water_heater" -> mapOf("water_heater" to state, "temperature" to num(attributes["temperature"]))
            "valve" -> mapOf("valve" to state, "position" to num(attributes["current_position"]))
            "alarm_control_panel" -> mapOf("alarm" to state)
            else -> emptyMap()
        }
    }

    private fun num(v: JsonElement?): Double? {
        val s = (v as? JsonPrimitive)?.content ?: return null
        return s.toDoubleOrNull()
    }
    private fun str(v: JsonElement?): String? = (v as? JsonPrimitive)?.content
    private fun rgb(v: JsonElement?): List<Int>? =
        (v as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt() }?.takeIf { it.size == 3 }
    private fun pct255(v: JsonElement?): Int? {
        val n = num(v) ?: return null
        return Math.round((n / 255.0) * 100.0).toInt()
    }
    private fun numStr(s: String): Double? = s.toDoubleOrNull()
}
