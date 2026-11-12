package alice.worker

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.security.Sealed
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class FakeHaAdminApi(
    baseUrl: String = "http://ha",
    token: String = "t",
    json: Json = Json { ignoreUnknownKeys = true },
) : HaAdminApi(baseUrl, token, json) {
    val calls = mutableListOf<String>()
    var scriptStore: JsonElement? = null
    var automationStore: JsonElement? = null
    var automationOn: Boolean? = null
    var failOp: String? = null
    var httpFailStatus: Int? = null

    private fun maybeFail(op: String) {
        if (failOp == op) {
            val st = httpFailStatus
            if (st != null) throw HaConfigHttpError(st, "boom")
            throw RuntimeException("boom")
        }
    }

    override suspend fun getScript(objectId: String): JsonElement? { calls += "getScript:$objectId"; maybeFail("getScript"); return scriptStore }
    override suspend fun getAutomation(id: String): JsonElement? { calls += "getAutomation:$id"; maybeFail("getAutomation"); return automationStore }
    override suspend fun putScript(objectId: String, config: JsonElement) { calls += "putScript:$objectId"; maybeFail("putScript"); scriptStore = config }
    override suspend fun deleteScript(objectId: String) { calls += "deleteScript:$objectId"; maybeFail("deleteScript"); scriptStore = null }
    override suspend fun putAutomation(id: String, config: JsonElement) { calls += "putAutomation:$id"; maybeFail("putAutomation"); automationStore = config }
    override suspend fun deleteAutomation(id: String) { calls += "deleteAutomation:$id"; maybeFail("deleteAutomation"); automationStore = null }
    override suspend fun reload(domain: String) { calls += "reload:$domain"; maybeFail("reload") }
    override suspend fun allStates(): JsonArray { calls += "allStates"; maybeFail("allStates"); return JsonArray(emptyList()) }
    override suspend fun automationEntityId(configId: String): String? { calls += "automationEntityId:$configId"; maybeFail("automationEntityId"); return if (automationStore != null) "automation.$configId" else null }
    override suspend fun automationEnabled(configId: String): Boolean? { calls += "automationEnabled:$configId"; maybeFail("automationEnabled"); return automationOn }
    override suspend fun setAutomationEnabled(entityId: String, enabled: Boolean) { calls += "setAutomationEnabled:$entityId:$enabled"; maybeFail("setAutomationEnabled"); automationOn = enabled }
    override suspend fun ensureModeSelect(options: List<String>): JsonObject { calls += "ensureModeSelect"; maybeFail("ensureModeSelect"); return buildJsonObject { put("entityId", ConfigOps.MODE_HELPER_ENTITY) } }
    override suspend fun exposeEntities(entityIds: List<String>, expose: Boolean) { calls += "expose:$expose:${entityIds.joinToString(",")}"; maybeFail("exposeEntities") }
    override suspend fun generateBackup(name: String): JsonObject { calls += "generateBackup"; maybeFail("generateBackup"); return buildJsonObject { put("backupId", "bak1"); put("sizeBytes", 0) } }
    override suspend fun backupInfo(backupId: String): JsonObject { calls += "backupInfo:$backupId"; maybeFail("backupInfo"); return buildJsonObject { put("exists", true); put("backupId", backupId) } }
    override suspend fun deleteBackup(backupId: String) { calls += "deleteBackup:$backupId"; maybeFail("deleteBackup") }
    override suspend fun restoreBackup(backupId: String) { calls += "restoreBackup:$backupId"; maybeFail("restoreBackup") }
    override fun close() { calls += "close" }
}

class ConfigWorkerIntegrationTest {
    private fun db(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seed(db: Database, adminTokenEnc: String) {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", "http://ha", "enc-op", adminTokenEnc, "connected", t, t)
        }
    }

    @Test fun `script upsert succeeds and writes result`() = runBlocking {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        val payload = buildJsonObject {
            put("objectId", "alice_scene_abc")
            put("config", buildJsonObject {
                put("alias", "Test")
                put("sequence", buildJsonArray { add(buildJsonObject { put("service", "light.turn_on"); put("target", buildJsonObject { put("entity_id", "light.k") }) }) })
            })
        }.toString()
        val t = System.currentTimeMillis()
        db.write { identityQueries.insertConfigJob("j1", "h1", "c1", "script.upsert", payload, null, t, "u1", t) }
        val fake = FakeHaAdminApi()
        val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> fake })
        assertTrue(w.tick())
        val job = db.read { identityQueries.selectConfigJobById("j1").executeAsOneOrNull() }!!
        assertEquals("done", job.status)
        assertTrue(fake.calls.any { it.startsWith("putScript:alice_scene_abc") })
        assertTrue(fake.calls.contains("reload:script"))
        assertTrue(fake.calls.contains("close"))
    }

    @Test fun `config verify returns drifted items`() = runBlocking {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        val payload = buildJsonObject {
            put("scripts", buildJsonArray {
                add(buildJsonObject { put("objectId", "alice_scene_x"); put("config", buildJsonObject { put("alias", "X"); put("sequence", JsonArray(emptyList())) }) })
            })
            put("automations", JsonArray(emptyList()))
        }.toString()
        val t = System.currentTimeMillis()
        db.write { identityQueries.insertConfigJob("jv", "h1", "c1", "config.verify", payload, null, t, "u1", t) }
        val fake = FakeHaAdminApi() // scriptStore null => missing
        val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> fake })
        assertTrue(w.tick())
        val job = db.read { identityQueries.selectConfigJobById("jv").executeAsOneOrNull() }!!
        assertEquals("done", job.status)
        assertTrue(job.result?.contains("\"drifted\"") == true)
        assertTrue(job.result?.contains("missing") == true)
    }

    @Test fun `transient failure retries then permanent failure`() = runBlocking {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        val payload = buildJsonObject { put("entityIds", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("light.k")) }); put("expose", true) }.toString()
        val t = System.currentTimeMillis()
        db.write { identityQueries.insertConfigJob("jr", "h1", "c1", "voice.expose", payload, null, t, "u1", t) }
        val fake = FakeHaAdminApi().apply { failOp = "exposeEntities"; httpFailStatus = 500 }
        val w = ConfigWorker(db, priv, "config-worker", retryDelayMs = 0, apiFactory = { _, _, _ -> fake })
        assertTrue(w.tick())
        var job = db.read { identityQueries.selectConfigJobById("jr").executeAsOneOrNull() }!!
        assertEquals("pending", job.status)
        assertEquals(1L, job.attempts)
        db.write { identityQueries.updateConfigJobStatus("pending", job.started_at, null, null, job.error, null, job.id) } // ensure not running
        // force run_after now
        db.write { identityQueries.retryConfigJob(job.error, 0, job.id) }
        fake.failOp = "exposeEntities"; fake.httpFailStatus = 500
        assertTrue(w.tick())
        job = db.read { identityQueries.selectConfigJobById("jr").executeAsOneOrNull() }!!
        assertEquals("pending", job.status)
        assertEquals(2L, job.attempts)
        db.write { identityQueries.retryConfigJob(job.error, 0, job.id) }
        assertTrue(w.tick())
        job = db.read { identityQueries.selectConfigJobById("jr").executeAsOneOrNull() }!!
        assertEquals("failed", job.status)
        assertEquals(3L, job.attempts)
    }

    @Test fun `permanent http 403 fails without retry`() = runBlocking {
        val db = db()
        val (pub, priv) = Sealed.generateKeyPair()
        seed(db, Sealed.seal("admin-token", pub))
        val payload = buildJsonObject { put("entityIds", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("light.k")) }); put("expose", true) }.toString()
        val t = System.currentTimeMillis()
        db.write { identityQueries.insertConfigJob("jp", "h1", "c1", "voice.expose", payload, null, t, "u1", t) }
        val fake = FakeHaAdminApi().apply { failOp = "exposeEntities"; httpFailStatus = 403 }
        val w = ConfigWorker(db, priv, "config-worker", apiFactory = { _, _, _ -> fake })
        assertTrue(w.tick())
        val job = db.read { identityQueries.selectConfigJobById("jp").executeAsOneOrNull() }!!
        assertEquals("failed", job.status)
        assertEquals(1L, job.attempts)
    }
}
