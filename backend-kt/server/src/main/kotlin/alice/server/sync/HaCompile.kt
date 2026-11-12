package alice.server.sync

import alice.ha.resolveOperation
import alice.server.actions.ActionSpec
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

object HaCompile {
    const val MODE_HELPER_ENTITY = "input_select.alice_household_mode"

    fun sceneObjectId(id: String) = "alice_scene_${id.removePrefix("scn_").replace("-", "_")}"
    fun routineObjectId(id: String) = "alice_routine_${id.removePrefix("rtn_").replace("-", "_")}"
    fun automationConfigId(id: String) = "alice_auto_${id.removePrefix("atm_").replace("-", "_")}"

    fun compileDeviceAction(entityId: String, action: String, parameters: Map<String, JsonElement>, continueOnError: Boolean = false): JsonObject {
        val domain = entityId.substringBefore('.', "")
        val paramsAny = parameters.mapValues { (_, v) -> jsonElementToAny(v) }
        val call = resolveOperation(domain, action, paramsAny) ?: throw IllegalArgumentException("No Home Assistant service for \"$action\" on $domain")
        return buildJsonObject {
            put("service", "${call.domain}.${call.service}")
            put("target", buildJsonObject { put("entity_id", entityId) })
            if (call.data.isNotEmpty()) put("data", anyMapToJson(call.data))
            if (continueOnError) put("continue_on_error", true)
        }
    }

    fun compileScene(name: String, description: String?, icon: String?, actions: List<ActionSpec>): JsonObject {
        val seq = buildJsonArray {
            add(buildJsonObject {
                put("parallel", JsonArray(actions.map { compileDeviceAction(it.entityId, it.action, it.parameters, true) }))
            })
        }
        return buildJsonObject {
            put("alias", "Alice scene: $name")
            if (!description.isNullOrBlank()) put("description", description)
            if (!icon.isNullOrBlank()) put("icon", "mdi:$icon")
            put("mode", "single")
            put("sequence", seq)
        }
    }

    fun compileRoutine(name: String, icon: String?, steps: JsonArray, onFailure: String): JsonObject {
        val keepGoing = onFailure == "continue"
        val seq = buildJsonArray {
            for (el in steps) {
                val s = el as? JsonObject ?: continue
                when (s["type"]?.jsonPrimitive?.contentOrNull) {
                    "device" -> {
                        val entityId = s["entityId"]?.jsonPrimitive?.contentOrNull ?: continue
                        val action = s["action"]?.jsonPrimitive?.contentOrNull ?: continue
                        val params = (s["parameters"] as? JsonObject)?.toMap() ?: emptyMap()
                        add(compileDeviceAction(entityId, action, params, keepGoing))
                    }
                    "scene" -> {
                        val sceneId = s["sceneId"]?.jsonPrimitive?.contentOrNull
                            ?: throw IllegalArgumentException("Routine scene step is missing sceneId")
                        add(buildJsonObject {
                            put("service", "script.${sceneObjectId(sceneId)}")
                            if (keepGoing) put("continue_on_error", true)
                        })
                    }
                    "mode" -> {
                        val mode = s["mode"]?.jsonPrimitive?.contentOrNull ?: continue
                        add(buildJsonObject {
                            put("service", "input_select.select_option")
                            put("target", buildJsonObject { put("entity_id", MODE_HELPER_ENTITY) })
                            put("data", buildJsonObject { put("option", mode) })
                        })
                    }
                    "delay" -> {
                        val seconds = s["seconds"]?.jsonPrimitive?.intOrNull ?: s["seconds"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: continue
                        add(buildJsonObject { put("delay", buildJsonObject { put("seconds", seconds) }) })
                    }
                }
            }
        }
        return buildJsonObject {
            put("alias", "Alice routine: $name")
            if (!icon.isNullOrBlank()) put("icon", "mdi:$icon")
            put("mode", "single")
            put("sequence", seq)
        }
    }

    data class AutomationCompileContext(
        val personEntityIds: List<String> = emptyList(),
        val personOfUser: (String) -> String? = { null },
        val powerLimit: (String) -> Pair<String, Int>? = { null }, // sensorEntityId, limitW
    )

    fun compileAutomation(name: String, def: JsonObject, ctx: AutomationCompileContext = AutomationCompileContext()): JsonObject {
        val triggerObj = def["trigger"] as? JsonObject ?: throw IllegalArgumentException("Missing trigger")
        val (triggers, extraConditions) = compileTrigger(triggerObj, ctx)
        val conds = buildJsonArray {
            extraConditions.forEach { add(it) }
            (def["conditions"] as? JsonArray)?.forEach { c ->
                val co = c as? JsonObject ?: return@forEach
                add(compileCondition(co))
            }
        }
        val actions = buildJsonArray {
            (def["actions"] as? JsonArray)?.forEach { a ->
                val ao = a as? JsonObject ?: return@forEach
                add(compileAction(ao))
            }
        }
        return buildJsonObject {
            put("alias", "Alice: $name")
            put("mode", "single")
            put("trigger", triggers)
            if (conds.isNotEmpty()) put("condition", conds)
            put("action", actions)
        }
    }

    private fun compileTrigger(t: JsonObject, ctx: AutomationCompileContext): Pair<JsonArray, List<JsonObject>> {
        val type = t["type"]?.jsonPrimitive?.contentOrNull
        return when (type) {
            "time" -> {
                val at = t["at"]?.jsonPrimitive?.contentOrNull ?: "00:00"
                JsonArray(listOf(buildJsonObject { put("platform", "time"); put("at", "$at:00") })) to emptyList()
            }
            "sunset", "sunrise" -> {
                val offMin = t["offsetMinutes"]?.jsonPrimitive?.intOrNull ?: 0
                val trig = buildJsonObject {
                    put("platform", "sun")
                    put("event", type)
                    if (offMin != 0) put("offset", formatOffset(offMin))
                }
                JsonArray(listOf(trig)) to emptyList()
            }
            "door_opens", "motion" -> {
                val eid = t["entityId"]?.jsonPrimitive?.contentOrNull ?: ""
                JsonArray(listOf(buildJsonObject { put("platform", "state"); put("entity_id", eid); put("to", "on") })) to emptyList()
            }
            "arrive" -> {
                val userId = t["userId"]?.jsonPrimitive?.contentOrNull
                val person = t["person"]?.jsonPrimitive?.contentOrNull
                val who: List<String> = when {
                    userId != null -> listOf(ctx.personOfUser(userId) ?: throw IllegalArgumentException("That member is not linked to a Home Assistant person"))
                    person == "anyone" -> ctx.personEntityIds.ifEmpty { throw IllegalArgumentException("No people are set up in Home Assistant yet") }
                    !person.isNullOrBlank() -> {
                        if (ctx.personEntityIds.isNotEmpty() && person !in ctx.personEntityIds) throw IllegalArgumentException("That person is not in Home Assistant")
                        listOf(person)
                    }
                    else -> throw IllegalArgumentException("Arrival trigger is missing person")
                }
                JsonArray(listOf(buildJsonObject { put("platform", "state"); put("entity_id", JsonArray(who.map { JsonPrimitive(it) })); put("to", "home") })) to emptyList()
            }
            "leave" -> {
                val who = ctx.personEntityIds.ifEmpty { throw IllegalArgumentException("No people are set up in Home Assistant yet") }
                val trig = buildJsonObject { put("platform", "state"); put("entity_id", JsonArray(who.map { JsonPrimitive(it) })); put("to", "not_home") }
                val extra = buildJsonObject { put("condition", "template"); put("value_template", "{{ states.person | selectattr('state', 'eq', 'home') | list | count == 0 }}") }
                JsonArray(listOf(trig)) to listOf(extra)
            }
            "power_over_limit" -> {
                val eid = t["entityId"]?.jsonPrimitive?.contentOrNull ?: ""
                val (sensor, limitW) = ctx.powerLimit(eid) ?: throw IllegalArgumentException("That device has no power limit set, or no power reading")
                val above = kotlin.math.round(limitW * 0.9).toInt()
                JsonArray(listOf(buildJsonObject { put("platform", "numeric_state"); put("entity_id", sensor); put("above", above) })) to emptyList()
            }
            else -> throw IllegalArgumentException("Unsupported trigger: ${type ?: "unknown"}")
        }
    }

    private fun compileCondition(c: JsonObject): JsonObject = when (c["type"]?.jsonPrimitive?.contentOrNull) {
        "dark" -> buildJsonObject { put("condition", "state"); put("entity_id", "sun.sun"); put("state", "below_horizon") }
        "someone_home" -> buildJsonObject { put("condition", "template"); put("value_template", "{{ states.person | selectattr('state', 'eq', 'home') | list | count > 0 }}") }
        "days" -> {
            val days = c["days"]?.jsonPrimitive?.contentOrNull
            val wd = if (days == "weekdays") listOf("mon","tue","wed","thu","fri") else listOf("sat","sun")
            buildJsonObject { put("condition", "time"); put("weekday", JsonArray(wd.map { JsonPrimitive(it) })) }
        }
        "mode" -> buildJsonObject { put("condition", "state"); put("entity_id", MODE_HELPER_ENTITY); put("state", c["mode"]?.jsonPrimitive?.contentOrNull ?: "home") }
        else -> throw IllegalArgumentException("Unsupported condition")
    }

    private fun compileAction(a: JsonObject): JsonObject = when (a["type"]?.jsonPrimitive?.contentOrNull) {
        "device" -> {
            val eid = a["entityId"]?.jsonPrimitive?.contentOrNull ?: ""
            val action = a["action"]?.jsonPrimitive?.contentOrNull ?: ""
            val params = (a["parameters"] as? JsonObject)?.toMap() ?: emptyMap()
            compileDeviceAction(eid, action, params, true)
        }
        "scene" -> {
            val sceneId = a["sceneId"]?.jsonPrimitive?.contentOrNull
                ?: throw IllegalArgumentException("Scene action is missing sceneId")
            buildJsonObject { put("service", "script.${sceneObjectId(sceneId)}"); put("continue_on_error", true) }
        }
        "routine" -> {
            val routineId = a["routineId"]?.jsonPrimitive?.contentOrNull
                ?: throw IllegalArgumentException("Routine action is missing routineId")
            buildJsonObject { put("service", "script.${routineObjectId(routineId)}"); put("continue_on_error", true) }
        }
        "mode" -> buildJsonObject {
            put("service", "input_select.select_option")
            put("target", buildJsonObject { put("entity_id", MODE_HELPER_ENTITY) })
            put("data", buildJsonObject { put("option", a["mode"]?.jsonPrimitive?.contentOrNull ?: "home") })
        }
        "notify" -> buildJsonObject {
            put("event", "alice_notification")
            put("event_data", buildJsonObject {
                put("title", a["title"]?.jsonPrimitive?.contentOrNull ?: "Home")
                put("message", a["message"]?.jsonPrimitive?.contentOrNull ?: "")
                val userIds = a["userIds"] as? JsonArray
                if (userIds != null) put("userIds", userIds)
            })
        }
        else -> throw IllegalArgumentException("Unsupported action")
    }

    private fun formatOffset(minutes: Int): String {
        val sign = if (minutes < 0) "-" else "+"
        val m = kotlin.math.abs(minutes)
        return "$sign${(m / 60).toString().padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}:00"
    }

    private fun jsonElementToAny(v: JsonElement): Any? = when (v) {
        is JsonPrimitive -> when {
            v.isString -> v.content
            v.content == "true" || v.content == "false" -> v.content.toBoolean()
            v.intOrNull != null -> v.intOrNull
            v.content.toLongOrNull() != null -> v.content.toLong()
            v.content.toDoubleOrNull() != null -> v.content.toDouble()
            else -> v.content
        }
        is JsonArray -> v.map { jsonElementToAny(it) }
        is JsonObject -> v.mapValues { jsonElementToAny(it.value) }
    }

    private fun anyMapToJson(map: Map<String, Any?>): JsonObject = buildJsonObject {
        map.forEach { (k, v) -> put(k, anyToJson(v)) }
    }

    private fun anyToJson(v: Any?): JsonElement = when (v) {
        null -> JsonNull
        is String -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        is Map<*, *> -> buildJsonObject { v.forEach { (k, vv) -> put(k.toString(), anyToJson(vv)) } }
        is List<*> -> JsonArray(v.map { anyToJson(it) })
        is JsonElement -> v
        else -> JsonPrimitive(v.toString())
    }
}
