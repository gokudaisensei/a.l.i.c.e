package alice.worker

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConfigOpsTest {
    @Test fun `valid script upsert passes`() {
        ConfigOps.validate("script.upsert", buildJsonObject {
            put("objectId", "alice_scene_test")
            put("config", buildJsonObject {
                put("alias", "Test")
                put("sequence", buildJsonArray {
                    add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.kitchen") }) })
                })
            })
        })
    }

    @Test fun `rejects non-alice script id`() {
        assertFailsWith<ConfigOps.ConfigOpError> {
            ConfigOps.validate("script.upsert", buildJsonObject {
                put("objectId", "bad_script")
                put("config", buildJsonObject {
                    put("alias", "Test")
                    put("sequence", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on") }) })
                })
            })
        }
    }

    @Test fun `rejects disallowed service`() {
        assertFailsWith<ConfigOps.ConfigOpError> {
            ConfigOps.validate("script.upsert", buildJsonObject {
                put("objectId", "alice_x")
                put("config", buildJsonObject {
                    put("alias", "Test")
                    put("sequence", buildJsonArray { add(buildJsonObject { put("service", "shell_command.evil") }) })
                })
            })
        }
    }

    @Test fun `valid automation upsert passes`() {
        ConfigOps.validate("automation.upsert", buildJsonObject {
            put("id", "alice_auto_1")
            put("config", buildJsonObject {
                put("alias", "A")
                put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "time"); put("at", "07:30:00") }) })
                put("action", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.k") }) }) })
            })
        })
    }

    @Test fun `voice expose validates entity ids and bounds`() {
        ConfigOps.validate("voice.expose", buildJsonObject {
            put("entityIds", buildJsonArray { add(JsonPrimitive("light.kitchen")) })
            put("expose", true)
        })
        assertFailsWith<ConfigOps.ConfigOpError> {
            ConfigOps.validate("voice.expose", buildJsonObject { put("entityIds", JsonArray(emptyList())); put("expose", true) })
        }
    }

    @Test fun `canonical compare ignores id and normalizes keys`() {
        val a = buildJsonObject {
            put("id", "abc")
            put("alias", "X")
            put("mode", "single")
            put("trigger", buildJsonArray { add(buildJsonObject { put("platform", "state"); put("entity_id", "light.a") }) })
        }
        val b = buildJsonObject {
            put("alias", "X")
            put("triggers", buildJsonArray { add(buildJsonObject { put("trigger", "state"); put("entity_id", "light.a") }) })
        }
        assertTrue(ConfigOps.sameConfig(a, b))
        assertFalse(ConfigOps.sameConfig(a, buildJsonObject { put("alias", "Y") }))
    }

    @Test fun `config verify bounds`() {
        ConfigOps.validate("config.verify", buildJsonObject {
            put("scripts", buildJsonArray { })
            put("automations", buildJsonArray { })
        })
    }
}
