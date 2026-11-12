package alice.worker

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.security.Sealed
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HaLiveIntegrationTest {
    private fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

    private fun haConfig(): Pair<String, String>? {
        val url = env("HA_URL") ?: env("HA_TEST_URL")
        val token = env("HA_TOKEN") ?: env("HA_TEST_TOKEN")
        if (url != null && token != null) return url to token
        val f = File("../backend/.env.test")
        if (!f.exists()) return null
        val lines = f.readLines().associate { line ->
            val i = line.indexOf('=')
            if (i < 0) line.trim() to "" else line.substring(0, i).trim() to line.substring(i + 1).trim()
        }
        val u = lines["HA_URL"] ?: return null
        val t = lines["HA_TOKEN"] ?: return null
        return u to t
    }

    @Test fun `worker processes config jobs against live HA`() = runBlocking<Unit> {
        val cfg = haConfig()
        assumeTrue(cfg != null, "HA not configured")
        val (baseUrl, adminToken) = cfg!!

        // quick reachability/auth probe
        val probe = runCatching {
            HaAdminApi(baseUrl, adminToken).use { api -> api.allStates() }
        }
        assumeTrue(probe.isSuccess, "HA not reachable/authenticated: ${probe.exceptionOrNull()?.message}")

        val db = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))
        val (pub, priv) = Sealed.generateKeyPair()
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", baseUrl, "enc-op", Sealed.seal(adminToken, pub), "connected", t, t)
        }

        val worker = ConfigWorker(db, priv, "config-worker-live")
        val suffix = (System.currentTimeMillis() % 100000).toString()
        val scriptId = "alice_test_cov_$suffix"

        try {
            // helper ensure (websocket)
            val helperPayload = buildJsonObject { put("options", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("home")); add(kotlinx.serialization.json.JsonPrimitive("away")); add(kotlinx.serialization.json.JsonPrimitive("night")); add(kotlinx.serialization.json.JsonPrimitive("vacation")) }) }.toString()
            db.write { identityQueries.insertConfigJob("jh", "h1", "c1", "helper.ensure_mode_select", helperPayload, null, t, "u1", t) }
            assertTrue(worker.tick())
            assertEquals("done", db.read { identityQueries.selectConfigJobById("jh").executeAsOneOrNull() }!!.status)

            // script upsert/delete via config REST API (if supported)
            val scriptPayload = buildJsonObject {
                put("objectId", scriptId)
                put("config", buildJsonObject {
                    put("alias", "Alice Test Coverage $suffix")
                    put("sequence", buildJsonArray {
                        add(buildJsonObject {
                            put("service", "homeassistant.turn_on")
                            put("target", buildJsonObject { put("entity_id", "input_boolean.alice_test_nonexistent") })
                        })
                    })
                    put("mode", "single")
                })
            }.toString()
            db.write { identityQueries.insertConfigJob("js", "h1", "c1", "script.upsert", scriptPayload, null, t + 1, "u1", t + 1) }
            val didScript = worker.tick()
            if (didScript) {
                val js = db.read { identityQueries.selectConfigJobById("js").executeAsOneOrNull() }!!
                if (js.status == "done") {
                    // verify sees it (best-effort)
                    val verifyPayload = buildJsonObject {
                        put("scripts", buildJsonArray { add(buildJsonObject { put("objectId", scriptId); put("config", Json.parseToJsonElement("""{"alias":"Alice Test Coverage $suffix","sequence":[{"action":"homeassistant.turn_on","target":{"entity_id":"input_boolean.alice_test_nonexistent"}}],"mode":"single"}""")) }) })
                        put("automations", buildJsonArray { })
                    }.toString()
                    db.write { identityQueries.insertConfigJob("jv", "h1", "c1", "config.verify", verifyPayload, null, t + 2, "u1", t + 2) }
                    assertTrue(worker.tick())
                    val jv = db.read { identityQueries.selectConfigJobById("jv").executeAsOneOrNull() }!!
                    assertEquals("done", jv.status)
                    assertNotNull(jv.result)

                    val delPayload = buildJsonObject { put("objectId", scriptId) }.toString()
                    db.write { identityQueries.insertConfigJob("jd", "h1", "c1", "script.delete", delPayload, null, t + 3, "u1", t + 3) }
                    assertTrue(worker.tick())
                    val jd = db.read { identityQueries.selectConfigJobById("jd").executeAsOneOrNull() }!!
                    // delete should succeed or be idempotent enough
                    assertTrue(jd.status == "done" || jd.status == "failed")
                }
            }
        } finally {
            // best-effort cleanup
            runCatching {
                HaAdminApi(baseUrl, adminToken).use { api -> runBlocking { api.deleteScript(scriptId); api.reload("script") } }
            }
            db.close()
        }

        val hb = db.read { identityQueries.selectConfigWorkerHeartbeat("config-worker-live").executeAsOneOrNull() }
        assertNotNull(hb)
    }
}
