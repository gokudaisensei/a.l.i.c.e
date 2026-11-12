package alice.worker

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.security.Sealed
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ConfigWorkerWrk3Test {
    private fun db(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seed(db: Database, adminTokenEnc: String) {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", "http://ha", "enc-op", adminTokenEnc, "connected", t, t)
        }
    }

    private fun job(db: Database, id: String, op: String, payload: String) {
        val t = System.currentTimeMillis()
        db.write { identityQueries.insertConfigJob(id, "h1", "c1", op, payload, null, t, "u1", t) }
    }

    private class HangingApi(
        private val hang: CompletableDeferred<Unit>,
        baseUrl: String = "http://ha",
        token: String = "t",
        json: Json = Json { ignoreUnknownKeys = true },
    ) : HaAdminApi(baseUrl, token, json) {
        override suspend fun putScript(objectId: String, config: JsonElement) { hang.await() }
        override suspend fun deleteScript(objectId: String) { hang.await() }
        override suspend fun putAutomation(id: String, config: JsonElement) { hang.await() }
        override suspend fun deleteAutomation(id: String) { hang.await() }
        override suspend fun setAutomationEnabled(entityId: String, enabled: Boolean) { hang.await() }
        override suspend fun automationEntityId(configId: String): String? { hang.await(); return "automation.$configId" }
        override suspend fun ensureModeSelect(options: List<String>): JsonObject { hang.await(); return buildJsonObject { put("entityId", ConfigOps.MODE_HELPER_ENTITY) } }
        override suspend fun exposeEntities(entityIds: List<String>, expose: Boolean) { hang.await() }
        override suspend fun getScript(objectId: String): JsonElement? { hang.await(); return null }
        override suspend fun getAutomation(id: String): JsonElement? { hang.await(); return null }
        override suspend fun generateBackup(name: String): JsonObject { hang.await(); return buildJsonObject { } }
        override suspend fun backupInfo(backupId: String): JsonObject { hang.await(); return buildJsonObject { } }
        override suspend fun deleteBackup(backupId: String) { hang.await() }
        override suspend fun restoreBackup(backupId: String) { hang.await() }
        override fun close() {}
    }

    @Test fun `missing required key fails permanently on first attempt for each operation`() = runBlocking<Unit> {
        val cases = listOf(
            "script.upsert" to buildJsonObject { put("config", buildJsonObject { }) }.toString() to "objectId",
            "script.upsert" to buildJsonObject { put("objectId", "alice_x") }.toString() to "config",
            "script.delete" to buildJsonObject { }.toString() to "objectId",
            "automation.upsert" to buildJsonObject { put("config", buildJsonObject { }) }.toString() to "id",
            "automation.upsert" to buildJsonObject { put("id", "alice_auto_x") }.toString() to "config",
            "automation.delete" to buildJsonObject { }.toString() to "id",
            "automation.set_enabled" to buildJsonObject { }.toString() to "id",
        )
        for ((i, triple) in cases.withIndex()) {
            val op = triple.first.first
            val payload = triple.first.second
            val missing = triple.second
            val db = db()
            val (pub, priv) = Sealed.generateKeyPair()
            seed(db, Sealed.seal("admin-token", pub))
            val jid = "j$i"
            job(db, jid, op, payload)
            val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> FakeHaAdminApi() })
            assertTrue(w.tick(), "tick should process job for $op missing $missing")
            val row = db.read { identityQueries.selectConfigJobById(jid).executeAsOneOrNull() }!!
            assertEquals("failed", row.status, "expected permanent failure for $op missing $missing")
            assertEquals(1L, row.attempts, "must not retry malformed payload for $op missing $missing")
            assertNotNull(row.error)
            assertTrue(row.error!!.contains("\"$missing\""), "error should name missing key for $op: ${row.error}")
        }
    }

    @Test fun `cancelling worker while perform is running leaves job running`() = runBlocking<Unit> {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        val payload = buildJsonObject {
            put("objectId", "alice_scene_x")
            put("config", buildJsonObject {
                put("alias", "Test")
                put("sequence", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.k") }) }) })
            })
        }.toString()
        job(db, "jc", "script.upsert", payload)
        val hang = CompletableDeferred<Unit>()
        val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> HangingApi(hang) })
        val t = launch { w.tick() }
        // let it claim and enter perform
        kotlinx.coroutines.delay(50)
        t.cancelAndJoin()
        val row = db.read { identityQueries.selectConfigJobById("jc").executeAsOneOrNull() }!!
        assertEquals("running", row.status, "cancelled mid-job must not be marked failed")
        assertEquals(1L, row.attempts, "cancelled mid-job must not consume a retry")
        assertEquals(null, row.error)
        assertEquals(null, row.result)
    }

    @Test fun `ordinary failure inside perform is still retried up to existing limit`() = runBlocking<Unit> {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        val payload = buildJsonObject { put("entityIds", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("light.k")) }); put("expose", true) }.toString()
        job(db, "jr2", "voice.expose", payload)
        val fake = FakeHaAdminApi().apply { failOp = "exposeEntities"; httpFailStatus = 500 }
        val w = ConfigWorker(db, priv, "config-worker", retryDelayMs = 0, apiFactory = { _, _, _ -> fake })
        assertTrue(w.tick())
        var row = db.read { identityQueries.selectConfigJobById("jr2").executeAsOneOrNull() }!!
        assertEquals("pending", row.status)
        assertEquals(1L, row.attempts)
        db.write { identityQueries.retryConfigJob(row.error, 0, "jr2") }
        assertTrue(w.tick())
        row = db.read { identityQueries.selectConfigJobById("jr2").executeAsOneOrNull() }!!
        assertEquals("pending", row.status)
        assertEquals(2L, row.attempts)
        db.write { identityQueries.retryConfigJob(row.error, 0, "jr2") }
        assertTrue(w.tick())
        row = db.read { identityQueries.selectConfigJobById("jr2").executeAsOneOrNull() }!!
        assertEquals("failed", row.status)
        assertEquals(3L, row.attempts)
    }

    private class TimingOutApi : HaAdminApi("http://ha", "t", Json { ignoreUnknownKeys = true }) {
        override suspend fun putScript(objectId: String, config: JsonElement) {
            // exactly what a Home Assistant call that gets no answer does
            kotlinx.coroutines.withTimeout(20) { kotlinx.coroutines.delay(10_000) }
        }
        override fun close() {}
    }

    /** Script writes time out; everything else succeeds. */
    private class TimingOutScriptsApi : HaAdminApi("http://ha", "t", Json { ignoreUnknownKeys = true }) {
        override suspend fun putScript(objectId: String, config: JsonElement) { kotlinx.coroutines.withTimeout(20) { kotlinx.coroutines.delay(10_000) } }
        override suspend fun exposeEntities(entityIds: List<String>, expose: Boolean) {}
        override fun close() {}
    }

    private val scriptPayload = buildJsonObject {
        put("objectId", "alice_scene_x")
        put("config", buildJsonObject {
            put("alias", "Test")
            put("sequence", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.k") }) }) })
        })
    }.toString()

    @Test fun `a Home Assistant timeout fails that job and does not stop the worker`() = runBlocking<Unit> {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        job(db, "jt", "script.upsert", scriptPayload)
        val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> TimingOutApi() })
        assertTrue(w.tick(), "a timeout must be handled inside tick, not thrown out of it")
        val row = db.read { identityQueries.selectConfigJobById("jt").executeAsOneOrNull() }!!
        assertEquals("failed", row.status, "a timed-out job is not retried (it may have half-happened)")
        assertEquals(1L, row.attempts)
    }

    @Test fun `the loop survives a timed-out job and goes on to the next one`() = runBlocking<Unit> {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        job(db, "j-a", "script.upsert", scriptPayload)
        val ok = buildJsonObject { put("entityIds", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("light.k")) }); put("expose", true) }.toString()
        job(db, "j-b", "voice.expose", ok)
        val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> TimingOutScriptsApi() })
        val loop = launch { w.runLoop(intervalMs = 20) }
        kotlinx.coroutines.withTimeout(5000) {
            while (db.read { identityQueries.selectConfigJobById("j-b").executeAsOneOrNull() }!!.status != "done") kotlinx.coroutines.delay(20)
        }
        assertEquals("failed", db.read { identityQueries.selectConfigJobById("j-a").executeAsOneOrNull() }!!.status)
        assertTrue(loop.isActive, "the worker loop must still be running")
        w.stop(); loop.cancelAndJoin()
    }
}
