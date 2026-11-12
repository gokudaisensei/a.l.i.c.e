package alice.server.commands

import alice.ha.NormalizedState

private fun toNumber(v: Any?): Double? = when (v) {
    is Number -> v.toDouble()
    is kotlinx.serialization.json.JsonPrimitive -> v.content.toDoubleOrNull()
    else -> null
}

private fun isNumber(v: Any?): Boolean = toNumber(v) != null

fun validateParameters(action: String, p: Map<String, Any?>): String? {
    val required = REQUIRED[action] ?: return null
    for (r in required) {
        val v = p[r.key]
        if (v == null) return "$action needs \"${r.key}\""
        when (r.type) {
            "number" -> {
                val n = toNumber(v)
                if (n == null) return "\"${r.key}\" must be a number"
                if (r.min != null && n < r.min) return "\"${r.key}\" must be between ${r.min} and ${r.max}"
                if (r.max != null && n > r.max) return "\"${r.key}\" must be between ${r.min} and ${r.max}"
            }
            "string" -> {
                val s = when (v) {
                    is String -> v
                    is kotlinx.serialization.json.JsonPrimitive -> v.content
                    else -> null
                }
                if (s == null) return "\"${r.key}\" must be a string"
            }
            "boolean" -> {
                val b = when (v) {
                    is Boolean -> v
                    is kotlinx.serialization.json.JsonPrimitive -> v.content.toBooleanStrictOrNull()
                    else -> null
                }
                if (b == null) return "\"${r.key}\" must be a boolean"
            }
            "rgb" -> {
                if (v is kotlinx.serialization.json.JsonArray) {
                    val nums = v.map { (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() }
                    if (nums.size != 3 || nums.any { it == null || it < 0 || it > 255 }) return "\"${r.key}\" must be [r, g, b] with values 0-255"
                } else if (v is List<*>) {
                    if (v.size != 3 || v.any { it !is Number || it.toInt() < 0 || it.toInt() > 255 }) return "\"${r.key}\" must be [r, g, b] with values 0-255"
                } else {
                    return "\"${r.key}\" must be [r, g, b] with values 0-255"
                }
            }
        }
    }
    return null
}

private data class Req(val key: String, val type: String, val min: Double? = null, val max: Double? = null)

private val REQUIRED: Map<String, List<Req>> = mapOf(
    "set_brightness" to listOf(Req("brightness_pct", "number", 1.0, 100.0)),
    "set_color_temperature" to listOf(Req("kelvin", "number", 1000.0, 12000.0)),
    "set_color" to listOf(Req("rgb", "rgb")),
    "set_speed" to listOf(Req("percentage", "number", 0.0, 100.0)),
    "set_oscillation" to listOf(Req("oscillating", "boolean")),
    "set_direction" to listOf(Req("direction", "string")),
    "set_preset_mode" to listOf(Req("preset_mode", "string")),
    "set_hvac_mode" to listOf(Req("hvac_mode", "string")),
    "set_temperature" to listOf(Req("temperature", "number", -50.0, 100.0)),
    "set_fan_mode" to listOf(Req("fan_mode", "string")),
    "set_swing_mode" to listOf(Req("swing_mode", "string")),
    "set_position" to listOf(Req("position", "number", 0.0, 100.0)),
    "set_value" to listOf(Req("value", "number")),
)

data class Expectation(val requested: Map<String, Any?>, val matches: (NormalizedState) -> Boolean)

private fun num(v: Any?): Double? = if (v is Number && v.toDouble().isFinite()) v.toDouble() else if (v is kotlinx.serialization.json.JsonPrimitive) v.content.toDoubleOrNull() else null
private fun near(actual: Any?, want: Double, tol: Double): Boolean = actual is Number && Math.abs(actual.toDouble() - want) <= tol

/** Command parameters arrive as JSON elements; normalized state holds plain values, so compare plain with plain. */
private fun plain(v: Any?): Any? = when (v) {
    is kotlinx.serialization.json.JsonPrimitive ->
        if (v.isString) v.content else v.content.toBooleanStrictOrNull() ?: v.content.toLongOrNull() ?: v.content.toDoubleOrNull() ?: v.content
    is kotlinx.serialization.json.JsonArray -> v.map { plain(it) }
    is kotlinx.serialization.json.JsonObject -> v.mapValues { plain(it.value) }
    else -> v
}

fun expectationFor(domain: String, action: String, params: Map<String, Any?>, before: NormalizedState): Expectation? {
    val p = params.mapValues { plain(it.value) }
    return when (action) {
        "turn_on" -> Expectation(mapOf("power" to true)) { v -> v["power"] == true }
        "turn_off" -> Expectation(mapOf("power" to false)) { v -> v["power"] == false }
        "toggle" -> if (before["power"] is Boolean) Expectation(mapOf("power" to !(before["power"] as Boolean))) { v -> v["power"] == !(before["power"] as Boolean) } else null
        "set_brightness" -> {
            val want = num(p["brightness_pct"])!!; Expectation(mapOf("power" to true, "brightness" to want)) { v -> v["power"] == true && near(v["brightness"], want, 1.0) }
        }
        "set_color_temperature" -> {
            val want = num(p["kelvin"])!!; Expectation(mapOf("color_temperature" to want)) { v -> near(v["color_temperature"], want, 60.0) }
        }
        "set_color" -> {
            val want = (p["rgb"] as? List<*>)?.map { num(it) ?: 0.0 } ?: emptyList()
            Expectation(mapOf("color" to mapOf("rgb" to want))) { v ->
                val rgb = (v["color"] as? Map<*, *>)?.get("rgb") as? List<*>
                rgb != null && rgb.size == 3 && want.size == 3 && rgb.indices.all { i -> near(rgb[i], want[i], 4.0) }
            }
        }
        "set_speed" -> {
            val want = num(p["percentage"])!!; Expectation(mapOf("fan_speed" to want)) { v -> near(v["fan_speed"], want, if (want == 0.0) 0.0 else 34.0) }
        }
        "set_oscillation" -> Expectation(mapOf("oscillation" to p["oscillating"])) { v -> v["oscillation"] == p["oscillating"] }
        "set_direction" -> Expectation(mapOf("direction" to p["direction"])) { v -> v["direction"] == p["direction"] }
        "set_preset_mode" -> {
            val key = if (domain == "climate") "climate_preset" else "fan_preset"
            Expectation(mapOf(key to p["preset_mode"])) { v -> v[key] == p["preset_mode"] }
        }
        "set_hvac_mode" -> Expectation(mapOf("hvac_mode" to p["hvac_mode"])) { v -> v["hvac_mode"] == p["hvac_mode"] }
        "set_temperature" -> {
            val want = num(p["temperature"])!!; Expectation(mapOf("target_temperature" to want)) { v -> near(v["target_temperature"], want, 0.5) }
        }
        "set_fan_mode" -> Expectation(mapOf("fan_mode" to p["fan_mode"])) { v -> v["fan_mode"] == p["fan_mode"] }
        "set_swing_mode" -> Expectation(mapOf("swing" to p["swing_mode"])) { v -> v["swing"] == p["swing_mode"] }
        "open" -> if (domain == "lock") Expectation(mapOf("lock" to "open")) { v -> v["lock"] == "open" } else Expectation(mapOf("cover" to "open")) { v -> v["cover"] == "open" }
        "close" -> Expectation(mapOf("cover" to "closed")) { v -> v["cover"] == "closed" }
        "set_position" -> {
            val want = num(p["position"])!!; Expectation(mapOf("position" to want)) { v -> near(v["position"], want, 2.0) }
        }
        "lock" -> Expectation(mapOf("lock" to "locked")) { v -> v["lock"] == "locked" }
        "unlock" -> Expectation(mapOf("lock" to "unlocked")) { v -> v["lock"] == "unlocked" }
        "set_value" -> {
            val want = num(p["value"])!!; Expectation(mapOf("number" to want)) { v -> near(v["number"], want, 0.01) }
        }
        else -> null
    }
}

val UNDO_WINDOW_MS = 10 * 60_000L

fun undoPlan(c: DeviceCommand): Pair<String, Map<String, Any?>?>? {
    if (c.state != CommandState.CONFIRMED || c.confirmedBy != "state" || c.source != CommandSource.USER) return null
    val prev = c.previousState ?: emptyMap()
    return when (c.action) {
        "turn_on" -> if (prev["power"] == false) "turn_off" to null else null
        "turn_off" -> if (prev["power"] == true) "turn_on" to null else null
        "toggle" -> "toggle" to null
        "lock" -> "unlock" to null
        "unlock" -> "lock" to null
        "set_brightness" -> if (prev["power"] == false) "turn_off" to null else if (prev["brightness"] is Number) "set_brightness" to mapOf("brightness_pct" to prev["brightness"]) else null
        "set_temperature" -> if (prev["target_temperature"] is Number) "set_temperature" to mapOf("temperature" to prev["target_temperature"]) else null
        "set_speed" -> if (prev["power"] == false) "turn_off" to null else if (prev["fan_speed"] is Number) "set_speed" to mapOf("percentage" to prev["fan_speed"]) else null
        else -> null
    }
}

fun isUndoable(c: DeviceCommand, now: Long): Boolean =
    c.undoneBy == null && c.undoOf == null && c.finishedAt != null && (now - c.finishedAt!!) <= UNDO_WINDOW_MS && undoPlan(c) != null

fun toPublicCommand(c: DeviceCommand, now: Long = System.currentTimeMillis()): PublicCommand {
    val masked = mapOf("ha_rejected" to "Home Assistant refused the command", "internal" to "Something went wrong")
    return PublicCommand(
        id = c.id, entityId = c.entityId, action = c.action, parameters = c.parameters, state = c.state.wire,
        requestedState = c.requestedState?.let { mapToJsonElement(it) },
        actualState = c.actualState?.let { mapToJsonElement(it) },
        requestedBy = c.requestedBy, source = c.source.wire, confirmedBy = c.confirmedBy,
        createdAt = c.createdAt, dispatchedAt = c.dispatchedAt, acceptedAt = c.acceptedAt,
        finishedAt = c.finishedAt, timeoutAt = c.timeoutAt,
        undoable = isUndoable(c, now), undoOf = c.undoOf, undoneBy = c.undoneBy,
        failure = c.failure?.let { (code, msg) -> PublicFailure(code.wire, masked[code.wire] ?: msg) },
    )
}

private fun mapToJsonElement(m: Map<String, Any?>): Map<String, kotlinx.serialization.json.JsonElement> =
    m.mapValues { (_, v) -> anyToJsonElement(v) }
