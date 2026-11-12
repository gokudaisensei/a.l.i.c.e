package alice.worker

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConfigOpsParityTest {

    private fun toAny(el: JsonElement): Any? = when (el) {
        is JsonNull -> null
        is JsonObject -> el.entries.associate { (k, v) -> k to toAny(v) }
        is JsonArray -> el.map { toAny(it) }
        is JsonPrimitive -> when {
            el.isString -> el.content
            el.booleanOrNull != null -> el.boolean
            el.longOrNull != null -> {
                val l = el.long
                if (l in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) l.toInt() else l
            }
            el.doubleOrNull != null -> el.double
            else -> el.content
        }
    }

    private fun workerVerdict(op: String, payload: JsonObject): Boolean = try {
        ConfigOps.validate(op, payload); true
    } catch (_: ConfigOps.ConfigOpError) { false }

    @Suppress("UNCHECKED_CAST")
    private fun haVerdict(op: String, payload: JsonObject): Boolean {
        val map = (toAny(payload) as? Map<*, *>)?.entries?.associate { (k, v) -> k.toString() to v } ?: emptyMap()
        val withOp = map + ("op" to op)
        return try {
            alice.ha.ConfigOps.validateOperation(withOp); true
        } catch (_: alice.ha.ConfigOps.ConfigOpError) { false }
    }

    private fun assertAgree(op: String, payload: JsonObject, label: String) {
        val w = workerVerdict(op, payload)
        val h = haVerdict(op, payload)
        assertEquals(w, h, "validators disagree for $label ($op): worker=$w ha=$h")
    }

    @Test fun `worker and ha validators agree on a shared set of operations`() = kotlin.test.assertNotNull(Unit).let {
        val cases = mutableListOf<Triple<String, JsonObject, String>>()

        fun add(op: String, label: String, payload: JsonObject) { cases += Triple(op, payload, label) }

        // valid script upsert (scene-like script)
        add("script.upsert", "valid script", buildJsonObject {
            put("objectId", "alice_scene_movie")
            put("config", buildJsonObject {
                put("alias", "Movie time")
                put("sequence", buildJsonArray {
                    add(buildJsonObject { put("service", "light.turn_off"); put("target", buildJsonObject { put("entity_id", "light.living_room") }) })
                })
            })
        })

        // valid automation (routine-like)
        add("automation.upsert", "valid automation", buildJsonObject {
            put("id", "alice_auto_morning")
            put("config", buildJsonObject {
                put("alias", "Morning")
                put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "time"); put("at", "07:30:00") }) })
                put("condition", buildJsonArray {
                    add(buildJsonObject { put("condition", "state"); put("entity_id", "person.sam"); put("state", "home") })
                })
                put("action", buildJsonArray {
                    add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) })
                })
            })
        })

        // disallowed service
        add("script.upsert", "disallowed service", buildJsonObject {
            put("objectId", "alice_scene_bad")
            put("config", buildJsonObject {
                put("alias", "Bad")
                put("sequence", buildJsonArray { add(buildJsonObject { put("service", "shell_command.run"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) })
            })
        })

        // disallowed template in condition
        add("automation.upsert", "disallowed template", buildJsonObject {
            put("id", "alice_auto_tpl")
            put("config", buildJsonObject {
                put("alias", "Tpl")
                put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "time"); put("at", "08:00") }) })
                put("condition", buildJsonArray {
                    add(buildJsonObject { put("condition", "template"); put("value_template", "{{ states('sensor.evil') }}") })
                })
                put("action", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) })
            })
        })

        // unknown trigger
        add("automation.upsert", "unknown trigger", buildJsonObject {
            put("id", "alice_auto_trig")
            put("config", buildJsonObject {
                put("alias", "Trig")
                put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "mqtt") }) })
                put("action", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) })
            })
        })

        // unknown condition
        add("automation.upsert", "unknown condition", buildJsonObject {
            put("id", "alice_auto_cond")
            put("config", buildJsonObject {
                put("alias", "Cond")
                put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "time"); put("at", "08:00") }) })
                put("condition", buildJsonArray { add(buildJsonObject { put("condition", "zone") }) })
                put("action", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) })
            })
        })

        // malformed entity id
        add("script.upsert", "malformed entity id", buildJsonObject {
            put("objectId", "alice_scene_ent")
            put("config", buildJsonObject {
                put("alias", "Ent")
                put("sequence", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "not-an-entity") }) }) })
            })
        })

        // oversized script sequence
        add("script.upsert", "oversized sequence", buildJsonObject {
            put("objectId", "alice_scene_big")
            put("config", buildJsonObject {
                put("alias", "Big")
                put("sequence", buildJsonArray {
                    repeat(61) { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) }
                })
            })
        })

        // valid scene/routine helper-style operations
        add("helper.ensure_mode_select", "valid helper", buildJsonObject { put("options", buildJsonArray { add(JsonPrimitive("home")); add(JsonPrimitive("away")) }) })
        add("voice.expose", "valid voice expose", buildJsonObject { put("entityIds", buildJsonArray { add(JsonPrimitive("light.kitchen")) }); put("expose", true) })
        add("script.delete", "valid script delete", buildJsonObject { put("objectId", "alice_scene_x") })
        add("automation.delete", "valid automation delete", buildJsonObject { put("id", "alice_auto_x") })

        // invalid ids
        add("script.upsert", "invalid script id", buildJsonObject {
            put("objectId", "not_alice")
            put("config", buildJsonObject { put("alias", "X"); put("sequence", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) }) })
        })
        add("automation.upsert", "invalid automation id", buildJsonObject {
            put("id", "nope")
            put("config", buildJsonObject {
                put("alias", "A")
                put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "time"); put("at", "07:30:00") }) })
                put("action", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) }) })
            })
        })

        assertTrue(cases.isNotEmpty())
        for ((op, payload, label) in cases) assertAgree(op, payload, label)
    }
}
