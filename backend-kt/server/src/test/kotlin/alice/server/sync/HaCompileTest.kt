package alice.server.sync

import alice.server.actions.ActionSpec
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HaCompileTest {
    @Test fun `compiles scene to HA script config`() {
        val cfg = HaCompile.compileScene(
            "Movie",
            "Dims lights",
            "movie",
            listOf(ActionSpec("light.living", "turn_on", mapOf("brightness_pct" to JsonPrimitive(30))))
        )
        assertEquals("Alice scene: Movie", cfg["alias"]?.jsonPrimitive?.content)
        assertEquals("single", cfg["mode"]?.jsonPrimitive?.content)
        val seq = cfg["sequence"]!!.jsonArray
        val parallel = seq[0].jsonObject["parallel"]!!.jsonArray
        assertEquals("light.turn_on", parallel[0].jsonObject["service"]?.jsonPrimitive?.content)
    }

    @Test fun `compiles routine steps`() {
        val steps = buildJsonArray {
            add(buildJsonObject { put("type","device"); put("entityId","light.k"); put("action","turn_off") })
            add(buildJsonObject { put("type","delay"); put("seconds",5) })
            add(buildJsonObject { put("type","mode"); put("mode","away") })
        }
        val cfg = HaCompile.compileRoutine("Goodnight", null, steps, "continue")
        assertEquals("Alice routine: Goodnight", cfg["alias"]?.jsonPrimitive?.content)
        val seq = cfg["sequence"]!!.jsonArray
        assertEquals(3, seq.size)
        assertEquals("input_select.select_option", seq[2].jsonObject["service"]?.jsonPrimitive?.content)
    }

    @Test fun `compiles supported automation definition`() {
        val def = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "time"); put("at", "07:30") })
            put("conditions", buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "home") }) })
            put("actions", buildJsonArray { add(buildJsonObject { put("type", "device"); put("entityId", "light.k"); put("action", "turn_on") }) })
        }
        val cfg = HaCompile.compileAutomation("Morning", def)
        assertEquals("Alice: Morning", cfg["alias"]?.jsonPrimitive?.content)
        assertTrue(cfg["trigger"]!!.jsonArray.isNotEmpty())
        assertEquals("07:30:00", cfg["trigger"]!!.jsonArray[0].jsonObject["at"]?.jsonPrimitive?.content)
    }

    @Test fun `compiles arrive and leave triggers with context`() {
        val ctx = HaCompile.AutomationCompileContext(
            personEntityIds = listOf("person.a", "person.b"),
            personOfUser = { if (it == "u1") "person.a" else null },
        )
        val arrive = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "arrive"); put("person", "anyone") })
            put("actions", buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "home") }) })
        }
        val cfg1 = HaCompile.compileAutomation("Arrive", arrive, ctx)
        assertEquals("state", cfg1["trigger"]!!.jsonArray[0].jsonObject["platform"]?.jsonPrimitive?.content)

        val arriveUser = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "arrive"); put("userId", "u1") })
            put("actions", buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "home") }) })
        }
        val cfg2 = HaCompile.compileAutomation("ArriveUser", arriveUser, ctx)
        assertEquals("person.a", cfg2["trigger"]!!.jsonArray[0].jsonObject["entity_id"]!!.jsonArray[0].jsonPrimitive.content)

        val leave = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "leave") })
            put("actions", buildJsonArray { add(buildJsonObject { put("type", "mode"); put("mode", "away") }) })
        }
        val cfg3 = HaCompile.compileAutomation("Leave", leave, ctx)
        assertTrue(cfg3["condition"]!!.jsonArray.any { it.jsonObject["condition"]?.jsonPrimitive?.content == "template" })
    }

    @Test fun `compiles power over limit trigger with context`() {
        val ctx = HaCompile.AutomationCompileContext(powerLimit = { if (it == "switch.heater") "sensor.heater_power" to 1000 else null })
        val def = buildJsonObject {
            put("version", 1)
            put("trigger", buildJsonObject { put("type", "power_over_limit"); put("entityId", "switch.heater") })
            put("actions", buildJsonArray { add(buildJsonObject { put("type", "device"); put("entityId", "switch.heater"); put("action", "turn_off") }) })
        }
        val cfg = HaCompile.compileAutomation("Power", def, ctx)
        assertEquals("numeric_state", cfg["trigger"]!!.jsonArray[0].jsonObject["platform"]?.jsonPrimitive?.content)
        assertEquals("sensor.heater_power", cfg["trigger"]!!.jsonArray[0].jsonObject["entity_id"]?.jsonPrimitive?.content)
    }
}
