package alice.server.config

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.TimeProvider
import alice.ha.ConfigJobService
import alice.ha.FakeGateway
import alice.server.sync.ConfigJobApplier
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ConfigJobServiceTest {
    private fun newDb(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seedHousehold(db: Database, hid: String = "hh1", uid: String = "usr1") {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser(uid, "User", t)
            identityQueries.insertHousehold(hid, "Home", t)
            identityQueries.insertHaConnection("conn1", hid, "HA", "http://ha", "enc-op", null, "connected", t, t)
        }
    }

    @Test fun `enqueue status get and applyResults marks applied`() {
        val db = newDb()
        seedHousehold(db)
        val svc = ConfigJobService(db)
        val id = svc.enqueue("hh1", "voice.expose", """{"entityIds":["light.k"],"expose":true}""", "voice:light.k", "usr1")
        assertNotNull(id)
        val st = svc.status("hh1")
        assertTrue(st.connected)
        assertEquals(1, st.pendingJobs)

        // simulate worker completion
        db.write {
            identityQueries.updateConfigJobStatus("done", System.currentTimeMillis(), System.currentTimeMillis(), """{"exposed":true}""", null, null, id)
        }
        val applied = svc.applyResults()
        assertEquals(1, applied)
        val job = svc.get(id)
        assertNotNull(job)
    }

    @Test fun `config verify drift marks scene drifted`() {
        val db = newDb()
        seedHousehold(db)
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertScene("scn_abc", "hh1", "Scene", null, null, """{"steps":[]}""", "usr1", t, t)
            identityQueries.updateScene("Scene", null, null, """{"steps":[]}""", t, null, "synced", null, t, "script.alice_scene_abc", "scn_abc")
        }
        val svc = ConfigJobService(db)
        val id = svc.enqueue("hh1", "config.verify", """{"scripts":[{"objectId":"alice_scene_abc","config":{}}],"automations":[]}""", null, "usr1")!!
        val drift = buildJsonObject {
            put("drifted", buildJsonArray { add(buildJsonObject { put("kind", "script"); put("id", "alice_scene_abc"); put("reason", "changed") }) })
            put("checked", 1)
        }.toString()
        db.write { identityQueries.updateConfigJobStatus("done", t, t, drift, null, null, id) }
        svc.applyResults()
        val scene = db.read { identityQueries.selectSceneById("scn_abc").executeAsOneOrNull() }!!
        assertEquals("drifted", scene.sync_status)
        assertTrue(scene.sync_error?.contains("Drift detected") == true)
    }

    @Test fun `status reports worker heartbeat`() {
        val db = newDb()
        seedHousehold(db)
        db.write {
            identityQueries.upsertConfigWorkerHeartbeat("config-worker", System.currentTimeMillis(), """{"status":"running"}""")
        }
        val svc = ConfigJobService(db)
        val st = svc.status("hh1")
        assertTrue(st.workerLastSeenAt != null)
        assertTrue(st.workerOnline)
    }

    @Test fun `script upsert done marks routine synced`() {
        val db = newDb()
        seedHousehold(db)
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertRoutine("rtn_abc", "hh1", "R", null, "[]", "stop", "usr1", t, t, null, "pending", null, null, null)
        }
        val svc = ConfigJobService(db)
        val id = svc.enqueue("hh1", "script.upsert", """{"objectId":"alice_routine_abc","config":{}}""", "script:alice_routine_abc", "usr1")!!
        db.write { identityQueries.updateConfigJobStatus("done", t, t, """{"entityId":"script.alice_routine_abc"}""", null, null, id) }
        svc.applyResults()
        val r = db.read { identityQueries.selectRoutineById("rtn_abc").executeAsOneOrNull() }!!
        assertEquals("synced", r.sync_status)
        assertEquals("script.alice_routine_abc", r.ha_entity_id)
    }

    @Test fun `automation failed marks automation failed with error`() {
        val db = newDb()
        seedHousehold(db)
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertAutomation("atm_abc", "hh1", "A", """{"version":1}""", 1, "pending", null, null, null, null, null, "usr1", t, t)
        }
        val svc = ConfigJobService(db)
        val id = svc.enqueue("hh1", "automation.upsert", """{"id":"alice_auto_abc","config":{}}""", "automation:alice_auto_abc", "usr1")!!
        db.write { identityQueries.updateConfigJobStatus("failed", t, t, null, "boom", null, id) }
        svc.applyResults()
        val a = db.read { identityQueries.selectAutomationById("atm_abc").executeAsOneOrNull() }!!
        assertEquals("failed", a.sync_status)
        assertTrue(a.sync_error?.contains("boom") == true)
    }

    @Test fun `two thousand enqueues get distinct cfg ids from the injected clock`() {
        val db = newDb()
        seedHousehold(db)
        val fixed = 1_700_000_000_000L
        val svc = ConfigJobService(db, time = TimeProvider { fixed })
        val ids = (1..2_000).map { svc.enqueue("hh1", "voice.expose", """{"entityIds":[],"expose":true}""", null, null)!! }
        assertEquals(2_000, ids.toSet().size)
        assertTrue(ids.all { it.startsWith("cfg_") && it.length == "cfg_".length + 26 })
        val row = db.read { identityQueries.selectConfigJobById(ids.last()).executeAsOne() }
        assertEquals(fixed, row.created_at)
        assertEquals(fixed, row.run_after)
    }

    @Test fun `applying a job stamps its times from the injected clock`() = runBlocking<Unit> {
        val db = newDb()
        seedHousehold(db)
        val fixed = 1_700_000_000_000L
        val svc = ConfigJobService(db, time = TimeProvider { fixed })
        val id = svc.enqueue("hh1", "voice.expose", """{"entityIds":[],"expose":true}""", null, null)!!
        val applier = ConfigJobApplier(db, FakeGateway(), time = TimeProvider { fixed })
        applier.applyPending("hh1")
        val row = db.read { identityQueries.selectConfigJobById(id).executeAsOne() }
        assertEquals("done", row.status)
        assertEquals(fixed, row.started_at)
        assertEquals(fixed, row.completed_at)
    }

    @Test fun `prune removes old applied jobs`() {
        val db = newDb()
        seedHousehold(db)
        val old = System.currentTimeMillis() - 10L * 86_400_000L
        db.write {
            identityQueries.insertConfigJob("old1", "hh1", "conn1", "voice.expose", "{}", null, old, "u1", old)
            identityQueries.updateConfigJobStatus("done", old, old, "{}", null, old, "old1")
        }
        val svc = ConfigJobService(db)
        svc.prune(7)
        val j = db.read { identityQueries.selectConfigJobById("old1").executeAsOneOrNull() }
        assertEquals(null, j)
    }

}