package alice.worker

import kotlinx.serialization.json.*

object ConfigOps {
    const val MODE_HELPER_NAME = "Alice household mode"
    const val MODE_HELPER_ENTITY = "input_select.alice_household_mode"
    val ALICE_ID = Regex("^alice_[a-z0-9_]{1,60}$")
    private val ENTITY_ID = Regex("^[a-z_]+\\.[a-z0-9_]+$")
    const val TEMPLATE_SOMEONE_HOME = "{{ states.person | selectattr('state', 'eq', 'home') | list | count > 0 }}"
    const val TEMPLATE_NO_ONE_HOME = "{{ states.person | selectattr('state', 'eq', 'home') | list | count == 0 }}"
    private val ALLOWED_TEMPLATES = setOf(TEMPLATE_SOMEONE_HOME, TEMPLATE_NO_ONE_HOME)

    private val SERVICES = setOf(
        "light.turn_on", "light.turn_off", "light.toggle",
        "fan.turn_on", "fan.turn_off", "fan.toggle", "fan.set_percentage", "fan.oscillate", "fan.set_direction", "fan.set_preset_mode",
        "climate.set_hvac_mode", "climate.set_temperature", "climate.set_fan_mode", "climate.set_preset_mode", "climate.set_swing_mode", "climate.turn_on", "climate.turn_off",
        "cover.open_cover", "cover.close_cover", "cover.stop_cover", "cover.set_cover_position",
        "lock.lock", "lock.unlock", "lock.open",
        "switch.turn_on", "switch.turn_off", "switch.toggle", "input_boolean.turn_on", "input_boolean.turn_off", "input_boolean.toggle",
        "media_player.turn_on", "media_player.turn_off", "media_player.toggle",
        "input_number.set_value", "number.set_value",
        "script.turn_on", "scene.turn_on", "input_select.select_option",
    )

    class ConfigOpError(message: String) : RuntimeException(message)

    private fun bad(m: String): Nothing = throw ConfigOpError(m)
    private fun isObj(v: JsonElement?): JsonObject? = v as? JsonObject
    private fun entity(v: JsonElement?, what: String) {
        val s = (v as? JsonPrimitive)?.contentOrNull
        if (s == null || !ENTITY_ID.matches(s)) bad("$what is not an entity id")
    }

    private fun checkAction(a: JsonElement?, depth: Int = 0) {
        val obj = isObj(a) ?: bad("Invalid action")
        if (depth > 3) bad("Invalid action")
        if ("service" in obj) {
            val svc = (obj["service"] as? JsonPrimitive)?.contentOrNull ?: bad("Invalid service")
            val aliceScript = Regex("^script\\.alice_[a-z0-9_]{1,60}$").matches(svc)
            if (svc !in SERVICES && !aliceScript) bad("Service $svc is not allowed")
            obj["target"]?.let { t ->
                val to = isObj(t) ?: bad("Invalid target")
                entity(to["entity_id"], "target")
            }
            if (svc == "input_select.select_option") {
                val to = isObj(obj["target"]) ?: bad("Only the Alice mode helper may be selected")
                if ((to["entity_id"] as? JsonPrimitive)?.contentOrNull != MODE_HELPER_ENTITY) bad("Only the Alice mode helper may be selected")
            }
            if (svc == "script.turn_on") {
                val to = isObj(obj["target"]) ?: bad("Only Alice scripts may be started")
                val eid = (to["entity_id"] as? JsonPrimitive)?.contentOrNull ?: ""
                if (!Regex("^script\\.alice_[a-z0-9_]{1,60}$").matches(eid)) bad("Only Alice scripts may be started")
            }
            if ("data" in obj && obj["data"] !is JsonObject) bad("Invalid data")
            return
        }
        if ("delay" in obj) {
            val d = isObj(obj["delay"]) ?: bad("Delay must be 1 to 3600 seconds")
            val s = (d["seconds"] as? JsonPrimitive)?.intOrNull ?: bad("Delay must be 1 to 3600 seconds")
            if (s < 1 || s > 3600) bad("Delay must be 1 to 3600 seconds")
            return
        }
        if ("parallel" in obj) {
            val arr = obj["parallel"] as? JsonArray ?: bad("Invalid parallel block")
            if (arr.size > 50) bad("Invalid parallel block")
            arr.forEach { checkAction(it, depth + 1) }
            return
        }
        if ("event" in obj) {
            if ((obj["event"] as? JsonPrimitive)?.contentOrNull != "alice_notification") bad("Only alice_notification events may be fired")
            return
        }
        bad("Unknown action type")
    }

    private fun checkTrigger(t: JsonElement?) {
        val obj = isObj(t) ?: bad("Invalid trigger")
        when ((obj["platform"] as? JsonPrimitive)?.contentOrNull ?: (obj["trigger"] as? JsonPrimitive)?.contentOrNull) {
            "state" -> {
                val eid = obj["entity_id"]
                when (eid) {
                    is JsonArray -> eid.forEach { entity(it, "trigger entity") }
                    else -> entity(eid, "trigger entity")
                }
            }
            "numeric_state" -> {
                entity(obj["entity_id"], "trigger entity")
                if (obj["above"] !is JsonPrimitive) bad("numeric trigger needs 'above'")
            }
            "time" -> {
                val at = (obj["at"] as? JsonPrimitive)?.contentOrNull ?: bad("Invalid time")
                if (!Regex("^\\d{2}:\\d{2}(:\\d{2})?$").matches(at)) bad("Invalid time")
            }
            "sun" -> {
                val ev = (obj["event"] as? JsonPrimitive)?.contentOrNull
                if (ev != "sunset" && ev != "sunrise") bad("Invalid sun event")
            }
            else -> bad("Trigger ${ (obj["platform"] as? JsonPrimitive)?.contentOrNull ?: "unknown" } is not allowed")
        }
    }

    private fun checkCondition(c: JsonElement?) {
        val obj = isObj(c) ?: bad("Invalid condition")
        when ((obj["condition"] as? JsonPrimitive)?.contentOrNull) {
            "state" -> { entity(obj["entity_id"], "condition entity"); if (obj["state"] !is JsonPrimitive) bad("Invalid state") }
            "template" -> {
                val v = (obj["value_template"] as? JsonPrimitive)?.contentOrNull ?: bad("That template is not allowed")
                if (v !in ALLOWED_TEMPLATES) bad("That template is not allowed")
            }
            "time" -> {
                val days = obj["weekday"] as? JsonArray ?: bad("Invalid weekdays")
                val ok = setOf("mon","tue","wed","thu","fri","sat","sun")
                if (days.any { (it as? JsonPrimitive)?.contentOrNull !in ok }) bad("Invalid weekdays")
            }
            else -> bad("Condition ${(obj["condition"] as? JsonPrimitive)?.contentOrNull ?: "unknown"} is not allowed")
        }
    }

    fun validate(operation: String, payload: JsonObject) {
        when (operation) {
            "script.upsert" -> {
                val objectId = (payload["objectId"] as? JsonPrimitive)?.contentOrNull ?: bad("script.upsert needs \"objectId\"")
                if (!ALICE_ID.matches(objectId)) bad("Script ids must start with alice_")
                val config = isObj(payload["config"]) ?: bad(if ("config" !in payload) "script.upsert needs \"config\"" else "Invalid script")
                if ((config["alias"] as? JsonPrimitive)?.contentOrNull == null) bad("Invalid script")
                val seq = config["sequence"] as? JsonArray ?: bad("Invalid script")
                if (seq.isEmpty() || seq.size > 60) bad("Invalid script")
                seq.forEach { checkAction(it) }
            }
            "script.delete" -> {
                val objectId = (payload["objectId"] as? JsonPrimitive)?.contentOrNull ?: bad("script.delete needs \"objectId\"")
                if (!ALICE_ID.matches(objectId)) bad("Ids must start with alice_")
            }
            "automation.delete" -> {
                val id = (payload["id"] as? JsonPrimitive)?.contentOrNull ?: bad("automation.delete needs \"id\"")
                if (!ALICE_ID.matches(id)) bad("Ids must start with alice_")
            }
            "automation.set_enabled" -> {
                val id = (payload["id"] as? JsonPrimitive)?.contentOrNull ?: bad("automation.set_enabled needs \"id\"")
                if (!ALICE_ID.matches(id)) bad("Ids must start with alice_")
            }
            "automation.upsert" -> {
                val id = (payload["id"] as? JsonPrimitive)?.contentOrNull ?: bad("automation.upsert needs \"id\"")
                if (!ALICE_ID.matches(id)) bad("Automation ids must start with alice_")
                val config = isObj(payload["config"]) ?: bad(if ("config" !in payload) "automation.upsert needs \"config\"" else "Invalid automation")
                if ((config["alias"] as? JsonPrimitive)?.contentOrNull == null) bad("Invalid automation")
                val triggers = config["trigger"] as? JsonArray ?: bad("Invalid automation")
                if (triggers.isEmpty() || triggers.size > 20) bad("Invalid automation")
                triggers.forEach { checkTrigger(it) }
                (config["condition"] as? JsonArray)?.forEach { checkCondition(it) }
                val actions = config["action"] as? JsonArray ?: bad("Invalid automation actions")
                if (actions.isEmpty() || actions.size > 60) bad("Invalid automation actions")
                actions.forEach { checkAction(it) }
            }
            "helper.ensure_mode_select" -> {
                val options = payload["options"] as? JsonArray ?: bad("Invalid options")
                if (options.size < 2 || options.size > 10) bad("Invalid options")
                val re = Regex("^[a-z_]{1,20}$")
                options.forEach { if ((it as? JsonPrimitive)?.contentOrNull?.let(re::matches) != true) bad("Invalid options") }
            }
            "voice.expose" -> {
                val ids = payload["entityIds"] as? JsonArray ?: bad("Invalid entity list")
                if (ids.isEmpty() || ids.size > 200) bad("Invalid entity list")
                ids.forEach { entity(it, "entity") }
                if (payload["expose"] !is JsonPrimitive) bad("expose must be true or false")
            }
            "backup.generate", "backup.info", "backup.delete", "backup.restore" -> { /* basic pass-through */ }
            "config.verify" -> {
                val scripts = payload["scripts"] as? JsonArray ?: bad("Invalid verification request")
                val autos = payload["automations"] as? JsonArray ?: bad("Invalid verification request")
                if (scripts.size + autos.size > 500) bad("Invalid verification request")
            }
            else -> bad("Unknown operation")
        }
    }

    // ---- canonical compare ----
    private val KEY_RENAMES = mapOf("service" to "action", "platform" to "trigger")

    fun canonicalConfig(value: JsonElement): JsonElement {
        fun walk(v: JsonElement): JsonElement {
            return when (v) {
                is JsonArray -> JsonArray(v.map { walk(it) })
                is JsonObject -> {
                    val entries = mutableListOf<Pair<String, JsonElement>>()
                    for ((key, raw) in v) {
                        val valEl = raw
                        if (key == "id") continue
                        if (valEl is JsonNull) continue
                        if (valEl is JsonPrimitive && valEl.isString && valEl.content == "") continue
                        if (key == "continue_on_error" && valEl is JsonPrimitive && valEl.booleanOrNull == false) continue
                        entries.add((KEY_RENAMES[key] ?: key) to walk(valEl))
                    }
                    val sorted = entries.sortedBy { it.first }
                    val obj = buildJsonObject { sorted.forEach { (k, vv) -> put(k, vv) } }
                    obj
                }
                else -> v
            }
        }
        val c = walk(value)
        if (c !is JsonObject) return c
        val m = c.toMutableMap()
        for ((plural, singular) in listOf("triggers" to "trigger", "conditions" to "condition", "actions" to "action")) {
            if (plural in m) { m[singular] = m.remove(plural)!! }
        }
        if ((m["mode"] as? JsonPrimitive)?.contentOrNull == "single") m.remove("mode")
        val cond = m["condition"]
        if (cond is JsonArray && cond.isEmpty()) m.remove("condition")
        for (k in listOf("trigger", "condition", "sequence", "action")) {
            val v = m[k]
            if (v != null && v !is JsonArray && k != "action") m[k] = JsonArray(listOf(v))
        }
        val cond2 = m["condition"]
        if (cond2 is JsonArray && cond2.isEmpty()) m.remove("condition")
        return JsonObject(m.toSortedMap())
    }

    fun sameConfig(a: JsonElement, b: JsonElement): Boolean = canonicalConfig(a).toString() == canonicalConfig(b).toString()
}
