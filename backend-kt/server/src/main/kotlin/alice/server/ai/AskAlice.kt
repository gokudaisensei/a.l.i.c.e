package alice.server.ai

import kotlinx.serialization.Serializable

@Serializable data class AssistantArea(val id: String, val name: String)
@Serializable data class AssistantScene(val id: String, val name: String, val description: String? = null)
@Serializable data class AssistantRoutine(val id: String, val name: String)

@Serializable
data class AssistantDevice(
    val id: String,
    val name: String,
    val areaId: String? = null,
    val domain: String,
    val manufacturer: String? = null,
    val ops: List<String> = emptyList(),
)

@Serializable
data class AssistantContext(
    val devices: List<AssistantDevice>,
    val areas: List<AssistantArea>,
    val scenes: List<AssistantScene>,
    val routines: List<AssistantRoutine>,
    val modes: List<String>,
)

@Serializable
data class CommandStep(val thingId: String, val action: String, val parameters: Map<String, kotlinx.serialization.json.JsonElement>? = null)

@Serializable
sealed interface Plan {
    @Serializable @kotlinx.serialization.SerialName("commands") data class Commands(val commands: List<CommandStep>) : Plan
    @Serializable @kotlinx.serialization.SerialName("scene") data class Scene(val id: String) : Plan
    @Serializable @kotlinx.serialization.SerialName("routine") data class Routine(val id: String) : Plan
    @Serializable @kotlinx.serialization.SerialName("mode") data class Mode(val mode: String) : Plan
    @Serializable @kotlinx.serialization.SerialName("device") data class Device(val thingId: String) : Plan
}

// Wire-friendly suggestion shape (flat plan fields to keep JSON simple and TS-like enough)
@Serializable
data class Suggestion(
    val kind: String,
    val label: String,
    val detail: String,
    val icon: String,
    val sensitive: Boolean,
    val plan: kotlinx.serialization.json.JsonObject,
)

private val STOP = setOf("the","a","an","my","in","on","off","all","please","turn","switch","set","to","of","and","everything","lock","unlock","dim","make","start","stop","mode","percent")
private val TYPES = listOf(
    Regex("\\b(lights?|lamps?)\\b") to listOf("light"),
    Regex("\\bfans?\\b") to listOf("fan"),
    Regex("\\b(plugs?|switch(es)?)\\b") to listOf("switch","input_boolean"),
    Regex("\\b(ac|thermostat|climate|heating)\\b") to listOf("climate"),
    Regex("\\b(doors?|locks?)\\b") to listOf("lock"),
)
private fun clamp(n: Double, a: Double, b: Double) = minOf(b, maxOf(a, n))
private fun clampInt(n: Int, a: Int, b: Int) = minOf(b, maxOf(a, n))
private fun norm(s: String) = s.lowercase().replace(Regex("[^a-z0-9% ]"), " ").replace(Regex("\\s+"), " ").trim()

private fun jsonPlanCommands(commands: List<CommandStep>, json: kotlinx.serialization.json.Json = kotlinx.serialization.json.Json { encodeDefaults = true; explicitNulls = false }): kotlinx.serialization.json.JsonObject =
    kotlinx.serialization.json.buildJsonObject {
        put("type", kotlinx.serialization.json.JsonPrimitive("commands"))
        put("commands", json.encodeToJsonElement(kotlinx.serialization.builtins.ListSerializer(CommandStep.serializer()), commands))
    }
private fun jsonPlan(type: String, key: String, value: String): kotlinx.serialization.json.JsonObject =
    kotlinx.serialization.json.buildJsonObject {
        put("type", kotlinx.serialization.json.JsonPrimitive(type))
        put(key, kotlinx.serialization.json.JsonPrimitive(value))
    }

private fun dedupe(items: List<Suggestion>) = items.distinctBy { it.label }

fun interpret(text: String, ctx: AssistantContext): List<Suggestion> {
    val q = norm(text)
    if (q.isBlank()) return suggestions(ctx)
    val words = q.split(' ').filter { it.isNotBlank() }
    val numStr = Regex("(\\d+)").find(q)?.groupValues?.getOrNull(1)
    val num = numStr?.toIntOrNull()
    var verb: String? = null
    verb = when {
        Regex("\\bunlock\\b").containsMatchIn(q) -> "unlock"
        Regex("\\block\\b").containsMatchIn(q) -> "lock"
        Regex("\\b(off|stop)\\b").containsMatchIn(q) -> "off"
        Regex("\\b(on|start)\\b").containsMatchIn(q) && !Regex("\\bmode\\b").containsMatchIn(q) -> "on"
        Regex("\\b(set|dim|brighten|make)\\b").containsMatchIn(q) && num != null -> "set"
        else -> null
    }
    val out = mutableListOf<Suggestion>()
    if (verb != null) {
        val area = ctx.areas.firstOrNull { q.contains(norm(it.name)) }
        val types = TYPES.filter { it.first.containsMatchIn(q) }.flatMap { it.second }
        val areaWords = if (area != null) norm(area.name).split(' ').filter { it.isNotBlank() }.toSet() else emptySet()
        val toks = words.filter { w -> w !in STOP && w !in areaWords && w.length > 2 && !w[0].isDigit() && TYPES.none { it.first.matches(w) } }
        val all = Regex("\\b(all|everything)\\b").containsMatchIn(q)
        val domains = when (verb) {
            "on", "off" -> listOf("light","switch","input_boolean","fan","climate")
            "lock", "unlock" -> listOf("lock")
            else -> listOf("light","climate")
        }
        val op = when (verb) { "on" -> "turn_on"; "off" -> "turn_off"; else -> verb }
        val list = ctx.devices.filter { d ->
            d.domain in domains && (types.isEmpty() || d.domain in types) && (area == null || d.areaId == area.id) &&
            toks.all { t -> norm("${d.name} ${d.manufacturer ?: ""}").contains(t) } &&
            (verb == "set" || op in d.ops)
        }
        if (list.isNotEmpty() && (area != null || types.isNotEmpty() || toks.isNotEmpty() || all || verb == "lock")) {
            val where = if (area != null) " in ${area.name}" else ""
            val lights = list.all { it.domain == "light" }
            val doors = list.all { it.domain == "lock" }
            val noun = if (list.size == 1) list[0].name else "${list.size} ${if (lights) "lights" else if (doors) "doors" else "devices"}$where"
            val detail = list.take(4).joinToString(", ") { it.name } + if (list.size > 4) "…" else ""
            if (verb == "on" || verb == "off") {
                out += Suggestion("commands", "Turn $verb $noun", detail, "bulb", false, jsonPlanCommands(list.map { CommandStep(it.id, op) }))
            }
            if (verb == "lock") {
                out += Suggestion("commands", "Lock $noun", detail, "lock", false, jsonPlanCommands(list.map { CommandStep(it.id, "lock") }))
            }
            if (verb == "unlock") {
                out += Suggestion("commands", "Unlock $noun", "Asks for your passkey first", "unlock", true, jsonPlanCommands(list.map { CommandStep(it.id, "unlock") }))
            }
            if (verb == "set" && num != null) {
                val climates = list.filter { it.domain == "climate" && "set_temperature" in it.ops }
                val dimmers = list.filter { it.domain == "light" && "set_brightness" in it.ops }
                val useClimate = climates.isNotEmpty() && (dimmers.isEmpty() || Regex("\\b(ac|thermostat|climate)\\b").containsMatchIn(q) || (num in 16..30 && !Regex("%|percent").containsMatchIn(q)))
                val target = if (useClimate) climates else dimmers
                if (target.isNotEmpty()) {
                    val value = if (useClimate) clampInt(num, 16, 30) else clampInt(num, 1, 100)
                    val label = if (useClimate) "Set ${if (target.size == 1) target[0].name else "${target.size} thermostats"} to ${value}°"
                                else "Set ${if (target.size == 1) target[0].name else "${target.size} lights"} to $value%"
                    val action = if (useClimate) "set_temperature" else "set_brightness"
                    val paramKey = if (useClimate) "temperature" else "brightness_pct"
                    val cmds = target.map { CommandStep(it.id, action, mapOf(paramKey to kotlinx.serialization.json.JsonPrimitive(value))) }
                    out += Suggestion("commands", label, target.joinToString(", ") { it.name }, if (useClimate) "thermo" else "bulb", false, jsonPlanCommands(cmds))
                }
            }
        }
    }
    for (s in ctx.scenes) {
        val sn = norm(s.name)
        val match = q.contains(sn) || sn.split(' ').filter { it.length > 3 }.any { w -> w in words && words.size <= 3 }
        if (match) out += Suggestion("scene", "Run \u201C${s.name}\u201D", s.description ?: "Scene", "play", false, jsonPlan("scene", "id", s.id))
    }
    for (r in ctx.routines) if (q.contains(norm(r.name))) out += Suggestion("routine", "Run \u201C${r.name}\u201D", "Routine", "layers", false, jsonPlan("routine", "id", r.id))
    for (m in ctx.modes) if (q.contains(m) && (q.contains("mode") || q == m)) out += Suggestion("mode", "Switch to ${m.replaceFirstChar { c -> c.uppercase() }} mode", "Household mode", "home", false, jsonPlan("mode", "mode", m))
    ctx.devices.filter { norm(it.name).contains(q) }.take(3).forEach { d ->
        out += Suggestion("device", d.name, "Show in Rooms", "bulb", false, jsonPlan("device", "thingId", d.id))
    }
    return dedupe(out)
}

private fun suggestions(ctx: AssistantContext): List<Suggestion> {
    val out = mutableListOf<Suggestion>()
    val lights = ctx.devices.filter { it.domain == "light" && "turn_off" in it.ops }
    if (lights.size > 1) out += interpret("turn off all lights", ctx).take(1)
    if (ctx.devices.any { it.domain == "lock" }) out += interpret("lock everything", ctx).take(1)
    for (s in ctx.scenes.take(2)) out += Suggestion("scene", "Run \u201C${s.name}\u201D", s.description ?: "Scene", "play", false, jsonPlan("scene", "id", s.id))
    if ("night" in ctx.modes) out += Suggestion("mode", "Switch to Night mode", "Household mode", "moon", false, jsonPlan("mode", "mode", "night"))
    return dedupe(out)
}

fun validateProposals(raw: kotlinx.serialization.json.JsonElement?, ctx: AssistantContext): List<Suggestion> {
    val obj = raw as? kotlinx.serialization.json.JsonObject ?: return emptyList()
    val list = (obj["proposals"] as? kotlinx.serialization.json.JsonArray)?.toList() ?: return emptyList()
    val out = mutableListOf<Suggestion>()
    for (item in list.take(5)) {
        val p = item as? kotlinx.serialization.json.JsonObject ?: continue
        val label = (p["label"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.take(120) ?: continue
        if (label.isBlank()) continue
        val type = (p["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        when (type) {
            "devices" -> {
                val commandsArr = (p["commands"] as? kotlinx.serialization.json.JsonArray)?.toList() ?: continue
                val commands = mutableListOf<CommandStep>()
                val names = mutableListOf<String>()
                var sensitive = false
                for (cEl in commandsArr.take(20)) {
                    val c = cEl as? kotlinx.serialization.json.JsonObject ?: continue
                    val thingId = (c["thingId"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
                    val action = (c["action"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
                    val d = ctx.devices.firstOrNull { it.id == thingId } ?: continue
                    if (action !in d.ops) continue
                    val params = mutableMapOf<String, kotlinx.serialization.json.JsonElement>()
                    when (action) {
                        "set_brightness" -> {
                            val v = ((c["parameters"] as? kotlinx.serialization.json.JsonObject)?.get("brightness_pct") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull() ?: continue
                            params["brightness_pct"] = kotlinx.serialization.json.JsonPrimitive(clampInt(v.toInt(), 1, 100))
                        }
                        "set_temperature" -> {
                            val v = ((c["parameters"] as? kotlinx.serialization.json.JsonObject)?.get("temperature") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull() ?: continue
                            params["temperature"] = kotlinx.serialization.json.JsonPrimitive(clampInt(v.toInt(), 16, 30))
                        }
                        "turn_on", "turn_off", "lock", "unlock", "toggle" -> {}
                        else -> continue
                    }
                    if (action == "unlock") sensitive = true
                    commands += CommandStep(d.id, action, if (params.isEmpty()) null else params)
                    names += d.name
                }
                if (commands.isNotEmpty()) {
                    out += Suggestion("commands", label, "${names.take(4).joinToString(", ")}${if (names.size > 4) "…" else ""} · Alice's best guess", "sparkle", sensitive, jsonPlanCommands(commands))
                }
            }
            "scene" -> {
                val id = (p["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
                if (ctx.scenes.any { it.id == id }) out += Suggestion("scene", label, "Scene · Alice's best guess", "sparkle", false, jsonPlan("scene", "id", id))
            }
            "routine" -> {
                val id = (p["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
                if (ctx.routines.any { it.id == id }) out += Suggestion("routine", label, "Routine · Alice's best guess", "sparkle", false, jsonPlan("routine", "id", id))
            }
            "mode" -> {
                val mode = (p["mode"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
                if (mode in ctx.modes) out += Suggestion("mode", label, "Household mode · Alice's best guess", "sparkle", false, jsonPlan("mode", "mode", mode))
            }
        }
    }
    return out
}
