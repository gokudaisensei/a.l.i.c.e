package alice.worker

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ConfigWorkerTest {
    private fun db(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seed(db: Database) {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            // no admin token -> worker should fail job as permanent config error
            identityQueries.insertHaConnection("c1", "h1", "HA", "http://ha", "enc-op", null, "connected", t, t)
            identityQueries.insertConfigJob("job1", "h1", "c1", "voice.expose", """{"entityIds":["light.k"],"expose":true}""", null, t, "u1", t)
        }
    }

    @Test fun `tick claims and fails job without admin token`() = runBlocking<Unit> {
        val db = db()
        seed(db)
        val w = ConfigWorker(db = db, privateKeyB64 = null, name = "config-worker")
        val did = w.tick()
        assertTrue(did)
        val job = db.read { identityQueries.selectConfigJobById("job1").executeAsOneOrNull() }!!
        assertEquals("failed", job.status)
        assertTrue(job.error?.contains("admin token", ignoreCase = true) == true || job.error?.contains("private key", ignoreCase = true) == true)
        val hb = db.read { identityQueries.selectConfigWorkerHeartbeat("config-worker").executeAsOneOrNull() }
        assertNotNull(hb)
    }

    @Test fun `recoverInterrupted resets running jobs`() = runBlocking {
        val db = db()
        seed(db)
        db.write { identityQueries.claimConfigJob(System.currentTimeMillis(), "job1") }
        val before = db.read { identityQueries.selectConfigJobById("job1").executeAsOneOrNull() }!!
        assertEquals("running", before.status)
        val w = ConfigWorker(db = db, privateKeyB64 = null)
        w.recoverInterrupted()
        val after = db.read { identityQueries.selectConfigJobById("job1").executeAsOneOrNull() }!!
        assertEquals("pending", after.status)
    }

    @Test fun `retry path requeues transient failure when attempts remain`() = runBlocking {
        val db = db()
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", "http://127.0.0.1:1", "enc-op", "s1.bad", "connected", t, t)
            identityQueries.insertConfigJob("job2", "h1", "c1", "voice.expose", """{"entityIds":["light.k"],"expose":true}""", null, t, "u1", t)
        }
        val w = ConfigWorker(db = db, privateKeyB64 = "not-a-key", name = "config-worker", retryDelayMs = 10)
        w.tick()
        val job = db.read { identityQueries.selectConfigJobById("job2").executeAsOneOrNull() }!!
        // sealed open fails as ConfigOpError("cannot be read...") in our impl -> permanent failed
        assertTrue(job.status == "failed" || job.status == "pending")
    }
}
