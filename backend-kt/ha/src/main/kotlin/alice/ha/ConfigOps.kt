package alice.ha

object ConfigOps {
    const val MODE_HELPER_NAME = "Alice household mode"
    const val MODE_HELPER_ENTITY = "input_select.alice_household_mode"
    val ALICE_ID = Regex("^alice_[a-z0-9_]{1,60}$")
    private val ENTITY_ID = Regex("^[a-z_]+\\.[a-z0-9_]+$")
    const val TEMPLATE_SOMEONE_HOME = "{{ states.person | selectattr('state', 'eq', 'home') | list | count > 0 }}"
    const val TEMPLATE_NO_ONE_HOME = "{{ states.person | selectattr('state', 'eq', 'home') | list | count == 0 }}"
    private val ALLOWED_TEMPLATES = setOf(TEMPLATE_SOMEONE_HOME, TEMPLATE_NO_ONE_HOME)
    private val TIME_RE = Regex("^\\d{2}:\\d{2}(:\\d{2})?$")
    private val OPTION_RE = Regex("^[a-z_]{1,20}$")
    private val WEEKDAYS = setOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")
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

    class ConfigOpError(message: String) : Exception(message)

    private fun bad(m: String): Nothing = throw ConfigOpError(m)
    private fun obj(v: Any?): Map<*, *>? = v as? Map<*, *>
    private fun arr(v: Any?): List<*>? = v as? List<*>
    private fun str(v: Any?): String? = v as? String
    private fun bool(v: Any?): Boolean? = v as? Boolean
    private fun intVal(v: Any?): Int? = when (v) {
        is Int -> v
        is Long -> if (v in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) v.toInt() else null
        is Double -> if (v % 1.0 == 0.0) v.toInt() else null
        is Float -> if (v % 1.0f == 0.0f) v.toInt() else null
        else -> null
    }

    private fun entity(v: Any?, what: String) {
        val s = str(v) ?: bad("$what is not an entity id")
        if (!ENTITY_ID.matches(s)) bad("$what is not an entity id")
    }

    private fun checkAction(a: Any?, depth: Int = 0) {
        val m = obj(a) ?: bad("Invalid action")
        if (depth > 3) bad("Invalid action")
        if ("service" in m) {
            val svc = str(m["service"]) ?: bad("Invalid service")
            val aliceScript = Regex("^script\\.alice_[a-z0-9_]{1,60}$").matches(svc)
            if (svc !in SERVICES && !aliceScript) bad("Service $svc is not allowed")
            m["target"]?.let { t ->
                val to = obj(t) ?: bad("Invalid target")
                entity(to["entity_id"], "target")
            }
            if (svc == "input_select.select_option") {
                val to = obj(m["target"]) ?: bad("Only the Alice mode helper may be selected")
                if (str(to["entity_id"]) != MODE_HELPER_ENTITY) bad("Only the Alice mode helper may be selected")
            }
            if (svc == "script.turn_on") {
                val to = obj(m["target"]) ?: bad("Only Alice scripts may be started")
                val eid = str(to["entity_id"]) ?: ""
                if (!Regex("^script\\.alice_[a-z0-9_]{1,60}$").matches(eid)) bad("Only Alice scripts may be started")
            }
            if ("data" in m && m["data"] !is Map<*, *>) bad("Invalid data")
            return
        }
        if ("delay" in m) {
            val d = obj(m["delay"]) ?: bad("Delay must be 1 to 3600 seconds")
            val s = intVal(d["seconds"]) ?: bad("Delay must be 1 to 3600 seconds")
            if (s < 1 || s > 3600) bad("Delay must be 1 to 3600 seconds")
            return
        }
        if ("parallel" in m) {
            val p = arr(m["parallel"]) ?: bad("Invalid parallel block")
            if (p.size > 50) bad("Invalid parallel block")
            p.forEach { checkAction(it, depth + 1) }
            return
        }
        if ("event" in m) {
            if (str(m["event"]) != "alice_notification") bad("Only alice_notification events may be fired")
            return
        }
        bad("Unknown action type")
    }

    private fun checkTrigger(t: Any?) {
        val m = obj(t) ?: bad("Invalid trigger")
        val platform = str(m["platform"]) ?: str(m["trigger"])
        when (platform) {
            "state" -> {
                val eid = m["entity_id"]
                when (eid) {
                    is List<*> -> eid.forEach { entity(it, "trigger entity") }
                    else -> entity(eid, "trigger entity")
                }
            }
            "numeric_state" -> {
                entity(m["entity_id"], "trigger entity")
                if (m["above"] == null) bad("numeric trigger needs 'above'")
            }
            "time" -> {
                val at = str(m["at"]) ?: bad("Invalid time")
                if (!TIME_RE.matches(at)) bad("Invalid time")
            }
            "sun" -> {
                val ev = str(m["event"])
                if (ev != "sunset" && ev != "sunrise") bad("Invalid sun event")
            }
            else -> bad("Trigger ${platform ?: "unknown"} is not allowed")
        }
    }

    private fun checkCondition(c: Any?) {
        val m = obj(c) ?: bad("Invalid condition")
        when (str(m["condition"])) {
            "state" -> {
                entity(m["entity_id"], "condition entity")
                if (str(m["state"]) == null) bad("Invalid state")
            }
            "template" -> {
                val v = str(m["value_template"]) ?: bad("That template is not allowed")
                if (v !in ALLOWED_TEMPLATES) bad("That template is not allowed")
            }
            "time" -> {
                val days = arr(m["weekday"]) ?: bad("Invalid weekdays")
                if (days.any { str(it) !in WEEKDAYS }) bad("Invalid weekdays")
            }
            else -> bad("Condition ${str(m["condition"]) ?: "unknown"} is not allowed")
        }
    }

    fun validateOperation(op: Map<String, Any?>) {
        val opType = str(op["op"]) ?: bad("Missing op")
        when (opType) {
            "script.upsert" -> {
                val objectId = str(op["objectId"]) ?: bad("script.upsert needs \"objectId\"")
                if (!ALICE_ID.matches(objectId)) bad("Script ids must start with alice_")
                val config = obj(op["config"]) ?: bad(if (!op.containsKey("config")) "script.upsert needs \"config\"" else "Invalid script")
                if (str(config["alias"]) == null) bad("Invalid script")
                val seq = arr(config["sequence"]) ?: bad("Invalid script")
                if (seq.isEmpty() || seq.size > 60) bad("Invalid script")
                seq.forEach { checkAction(it) }
            }
            "script.delete" -> {
                val objectId = str(op["objectId"]) ?: bad("script.delete needs \"objectId\"")
                if (!ALICE_ID.matches(objectId)) bad("Ids must start with alice_")
            }
            "automation.delete" -> {
                val id = str(op["id"]) ?: bad("automation.delete needs \"id\"")
                if (!ALICE_ID.matches(id)) bad("Ids must start with alice_")
            }
            "automation.set_enabled" -> {
                val id = str(op["id"]) ?: bad("automation.set_enabled needs \"id\"")
                if (!ALICE_ID.matches(id)) bad("Ids must start with alice_")
            }
            "automation.upsert" -> {
                val id = str(op["id"]) ?: bad("automation.upsert needs \"id\"")
                if (!ALICE_ID.matches(id)) bad("Automation ids must start with alice_")
                val config = obj(op["config"]) ?: bad(if (!op.containsKey("config")) "automation.upsert needs \"config\"" else "Invalid automation")
                if (str(config["alias"]) == null) bad("Invalid automation")
                val triggers = arr(config["trigger"]) ?: bad("Invalid automation")
                if (triggers.isEmpty() || triggers.size > 20) bad("Invalid automation")
                triggers.forEach { checkTrigger(it) }
                arr(config["condition"])?.forEach { checkCondition(it) }
                val actions = arr(config["action"]) ?: bad("Invalid automation actions")
                if (actions.isEmpty() || actions.size > 60) bad("Invalid automation actions")
                actions.forEach { checkAction(it) }
            }
            "helper.ensure_mode_select" -> {
                val options = arr(op["options"]) ?: bad("Invalid options")
                if (options.size < 2 || options.size > 10) bad("Invalid options")
                options.forEach { if (str(it)?.let(OPTION_RE::matches) != true) bad("Invalid options") }
            }
            "voice.expose" -> {
                val ids = arr(op["entityIds"]) ?: bad("Invalid entity list")
                if (ids.isEmpty() || ids.size > 200) bad("Invalid entity list")
                ids.forEach { entity(it, "entity") }
                if (bool(op["expose"]) == null) bad("expose must be true or false")
            }
            "backup.generate", "backup.info", "backup.delete", "backup.restore" -> { /* basic pass-through */ }
            "config.verify" -> {
                val scripts = arr(op["scripts"]) ?: bad("Invalid verification request")
                val autos = arr(op["automations"]) ?: bad("Invalid verification request")
                if (scripts.size + autos.size > 500) bad("Invalid verification request")
            }
            else -> bad("Unknown operation: $opType")
        }
    }

    fun toJob(op: Map<String, Any?>): Pair<String, Map<String, Any?>> {
        val operation = str(op["op"]) ?: throw ConfigOpError("Missing op")
        val payload = op.filterKeys { it != "op" }
        return operation to payload
    }

    fun canonicalConfig(value: Any?): Any? {
        if (value is List<*>) return value.map { canonicalConfig(it) }
        if (value !is Map<*, *>) return value
        val entries = mutableListOf<Pair<String, Any?>>()
        for ((k, v) in value) {
            val key = k.toString()
            val renamed = if (key == "service") "action" else if (key == "platform") "trigger" else key
            if (key == "id" || v == null || v == "") continue
            if (key == "continue_on_error" && v == false) continue
            entries.add(renamed to canonicalConfig(v))
        }
        return entries.sortedBy { it.first }.toMap()
    }

    fun sameConfig(a: Any?, b: Any?): Boolean = canonicalConfig(a)?.toString() == canonicalConfig(b)?.toString()
}
