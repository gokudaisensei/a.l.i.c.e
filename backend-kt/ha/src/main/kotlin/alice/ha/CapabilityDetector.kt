package alice.ha

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable

@Serializable
data class DeviceCapability(
    val name: String,
    val readable: Boolean,
    val controllable: Boolean,
    val operations: List<String>,
    val metadata: Map<String, @Contextual Any?> = emptyMap(),
)

data class CapabilitySource(val entityId: String, val domain: String, val attributes: Map<String, JsonElement>)

object CapabilityDetector {
    private object FanFeature {
        const val SET_SPEED = 1
        const val OSCILLATE = 2
        const val DIRECTION = 4
        const val PRESET_MODE = 8
    }

    private object ClimateFeature {
        const val TARGET_TEMPERATURE = 1
        const val FAN_MODE = 8
        const val PRESET_MODE = 16
        const val SWING_MODE = 32
    }

    private object CoverFeature {
        const val OPEN = 1
        const val CLOSE = 2
        const val SET_POSITION = 4
        const val STOP = 8
    }

    private object LockFeature {
        const val OPEN = 1
    }

    private fun has(features: Int, bit: Int) = (features and bit) != 0
    private fun list(v: JsonElement?): List<String> = (v as? kotlinx.serialization.json.JsonArray)?.map { it.toString().trim('"') } ?: emptyList()
    private fun features(a: Map<String, JsonElement>) = (a["supported_features"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
    private fun power(ops: List<String> = listOf("turn_on", "turn_off", "toggle")) = DeviceCapability("power", true, true, ops)

    fun detect(src: CapabilitySource): List<DeviceCapability> {
        val a = src.attributes
        val f = features(a)
        return when (src.domain) {
            "light" -> {
                val modes = list(a["supported_color_modes"])
                val caps = mutableListOf(power())
                if (modes.any { it != "onoff" }) caps.add(DeviceCapability("brightness", true, true, listOf("set_brightness"), mapOf("min" to 1, "max" to 100, "unit" to "%")))
                if (modes.contains("color_temp")) caps.add(DeviceCapability("color_temperature", true, true, listOf("set_color_temperature"), mapOf("minKelvin" to a["min_color_temp_kelvin"], "maxKelvin" to a["max_color_temp_kelvin"])))
                if (modes.any { it in setOf("hs", "xy", "rgb", "rgbw", "rgbww") }) caps.add(DeviceCapability("color", true, true, listOf("set_color")))
                caps
            }
            "switch", "input_boolean" -> listOf(power())
            "fan" -> {
                val caps = mutableListOf(power())
                if (has(f, FanFeature.SET_SPEED)) caps.add(DeviceCapability("fan_speed", true, true, listOf("set_speed")))
                if (has(f, FanFeature.OSCILLATE)) caps.add(DeviceCapability("oscillation", true, true, listOf("set_oscillation")))
                if (has(f, FanFeature.DIRECTION)) caps.add(DeviceCapability("direction", true, true, listOf("set_direction")))
                if (has(f, FanFeature.PRESET_MODE)) caps.add(DeviceCapability("fan_preset", true, true, listOf("set_preset_mode")))
                caps
            }
            "climate" -> {
                val modes = list(a["hvac_modes"])
                val caps = mutableListOf<DeviceCapability>()
                if (modes.isNotEmpty()) caps.add(DeviceCapability("hvac_mode", true, true, listOf("set_hvac_mode"), mapOf("modes" to modes)))
                if (has(f, ClimateFeature.TARGET_TEMPERATURE)) caps.add(DeviceCapability("target_temperature", true, true, listOf("set_temperature")))
                if (has(f, ClimateFeature.FAN_MODE)) caps.add(DeviceCapability("fan_mode", true, true, listOf("set_fan_mode")))
                if (has(f, ClimateFeature.PRESET_MODE)) caps.add(DeviceCapability("climate_preset", true, true, listOf("set_preset_mode")))
                if (has(f, ClimateFeature.SWING_MODE)) caps.add(DeviceCapability("swing", true, true, listOf("set_swing_mode")))
                caps.add(DeviceCapability("temperature", true, false, emptyList()))
                caps
            }
            "cover" -> {
                val ops = mutableListOf<String>()
                if (has(f, CoverFeature.OPEN)) ops.add("open")
                if (has(f, CoverFeature.CLOSE)) ops.add("close")
                if (has(f, CoverFeature.STOP)) ops.add("stop")
                val caps = mutableListOf(DeviceCapability("cover", true, ops.isNotEmpty(), ops))
                if (has(f, CoverFeature.SET_POSITION)) caps.add(DeviceCapability("position", true, true, listOf("set_position")))
                caps
            }
            "lock" -> listOf(DeviceCapability("lock", true, true, if (has(f, LockFeature.OPEN)) listOf("lock", "unlock", "open") else listOf("lock", "unlock"), mapOf("sensitive" to true)))
            "scene" -> listOf(DeviceCapability("scene", true, true, listOf("activate")))
            "script" -> listOf(DeviceCapability("script", true, true, listOf("run")))
            "input_number", "number" -> listOf(DeviceCapability("number", true, true, listOf("set_value"), mapOf("min" to a["min"], "max" to a["max"], "step" to a["step"])))
            "media_player" -> listOf(power(listOf("turn_on", "turn_off")))
            "sensor" -> listOf(DeviceCapability("sensor", true, false, emptyList(), mapOf("deviceClass" to a["device_class"], "unit" to a["unit_of_measurement"])))
            "binary_sensor" -> listOf(DeviceCapability("binary_sensor", true, false, emptyList(), mapOf("deviceClass" to a["device_class"])))
            "camera" -> listOf(DeviceCapability("camera", true, false, emptyList()))
            else -> listOf(DeviceCapability("state", true, false, emptyList()))
        }
    }

    fun supportsOperation(caps: List<DeviceCapability>, operation: String): Boolean =
        caps.any { it.controllable && operation in it.operations }
}

data class ServiceCall(val domain: String, val service: String, val data: Map<String, Any?>)

fun resolveOperation(domain: String, operation: String, params: Map<String, Any?> = emptyMap()): ServiceCall? {
    val service = when (operation) {
        "turn_on" -> "turn_on"
        "toggle" -> "toggle"
        "turn_off" -> "turn_off"
        "set_brightness" -> "turn_on"
        "set_color_temperature" -> "turn_on"
        "set_color" -> "turn_on"
        "set_speed" -> "set_percentage"
        "set_oscillation" -> "oscillate"
        "set_direction" -> "set_direction"
        "set_preset_mode" -> "set_preset_mode"
        "set_hvac_mode" -> "set_hvac_mode"
        "set_temperature" -> "set_temperature"
        "set_fan_mode" -> "set_fan_mode"
        "set_swing_mode" -> "set_swing_mode"
        "open" -> if (domain == "lock") "open" else "open_cover"
        "close" -> "close_cover"
        "stop" -> "stop_cover"
        "set_position" -> "set_cover_position"
        "lock" -> "lock"
        "unlock" -> "unlock"
        "set_value" -> "set_value"
        "activate" -> "turn_on"
        "run" -> "turn_on"
        else -> return null
    }
    val data = when (operation) {
        "set_brightness" -> mapOf("brightness_pct" to params["brightness_pct"])
        "set_color_temperature" -> mapOf("color_temp_kelvin" to params["kelvin"])
        "set_color" -> mapOf("rgb_color" to params["rgb"])
        "set_speed" -> mapOf("percentage" to params["percentage"])
        "set_oscillation" -> mapOf("oscillating" to params["oscillating"])
        "set_direction" -> mapOf("direction" to params["direction"])
        "set_preset_mode" -> mapOf("preset_mode" to params["preset_mode"])
        "set_hvac_mode" -> mapOf("hvac_mode" to params["hvac_mode"])
        "set_temperature" -> mapOf("temperature" to params["temperature"])
        "set_fan_mode" -> mapOf("fan_mode" to params["fan_mode"])
        "set_swing_mode" -> mapOf("swing_mode" to params["swing_mode"])
        "set_position" -> mapOf("position" to params["position"])
        "set_value" -> mapOf("value" to params["value"])
        else -> emptyMap()
    }.filterValues { it != null }
    return ServiceCall(domain, service, data)
}
