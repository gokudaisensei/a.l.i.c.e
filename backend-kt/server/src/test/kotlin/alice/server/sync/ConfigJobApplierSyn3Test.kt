package alice.server.sync

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.ha.ConfigJobService
import alice.ha.FakeGateway
import alice.server.sync.ConfigJobApplier
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

class ConfigJobApplierSyn3Test {
    private fun newDb(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seedHousehold(db: Database, hid: String, adminTokenEnc: String? = null) {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u_$hid", "User", t)
            identityQueries.insertUserPreferences("u_$hid")
            identityQueries.insertHousehold(hid, "Home", t)
            identityQueries.insertHouseholdSettings(hid)
            identityQueries.insertHaConnection("conn_$hid", hid, "HA", "http://ha", "enc-op", adminTokenEnc, "connected", t, t)
        }
    }

    @Test
    fun `applyPending skips running jobs, applies pending jobs once, and ignores a second call`() = runBlocking<Unit> {
        val db = newDb()
        seedHousehold(db, "hh1")
        val jobs = ConfigJobService(db)
        val pendingId = jobs.enqueue("hh1", "voice.expose", """{"entityIds":[],"expose":true}""", "voice:pending", null)!!
        val runningId = jobs.enqueue("hh1", "voice.expose", """{"entityIds":[],"expose":true}""", "voice:running", null)!!
        db.write { identityQueries.updateConfigJobStatus("running", System.currentTimeMillis(), null, null, null, null, runningId) }

        val applier = ConfigJobApplier(db, FakeGateway())
        val first = applier.applyPending("hh1")
        assertEquals(1, first.applied)
        assertEquals(0, first.failed)
        assertEquals("done", db.read { identityQueries.selectConfigJobById(pendingId).executeAsOne().status })
        assertEquals("running", db.read { identityQueries.selectConfigJobById(runningId).executeAsOne().status })

        val second = applier.applyPending("hh1")
        assertEquals(0, second.applied)
        assertEquals(0, second.failed)
    }

    @Test
    fun `applyPending with null applies every household that needs the in-process fallback`() = runBlocking<Unit> {
        val db = newDb()
        seedHousehold(db, "hh1")
        seedHousehold(db, "hh2", adminTokenEnc = "admin-token")
        val jobs = ConfigJobService(db)
        val noTokenJob = jobs.enqueue("hh1", "voice.expose", """{"entityIds":[],"expose":true}""", "voice:no-token", null)!!
        val adminTokenJob = jobs.enqueue("hh2", "voice.expose", """{"entityIds":[],"expose":true}""", "voice:admin-token", null)!!

        val applier = ConfigJobApplier(db, FakeGateway())
        val result = applier.applyPending(null)
        assertEquals(1, result.applied)
        assertEquals("done", db.read { identityQueries.selectConfigJobById(noTokenJob).executeAsOne().status })
        assertEquals("pending", db.read { identityQueries.selectConfigJobById(adminTokenJob).executeAsOne().status })
    }
}
