package alice.server.ha

import alice.core.config.AppConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.error.AppException
import alice.core.security.Sealed
import alice.core.time.SystemTimeProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class HaConnectionAdminServiceTest {
    @Test fun `stores sealed admin token when connection and public key exist`() {
        val db = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))
        val t = System.currentTimeMillis()
        val (pub, priv) = Sealed.generateKeyPair()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", "http://ha", "enc-op", null, "connected", t, t)
        }
        val svc = HaConnectionAdminService(db, AppConfig(adminSealPublicKey = pub), SystemTimeProvider)
        svc.setAdminToken("h1", "u1", "secret-admin-token")
        val row = db.read { identityQueries.selectHaConnectionByHousehold("h1").executeAsOneOrNull() }!!
        assertNotNull(row.admin_token_enc)
        assertEquals("secret-admin-token", Sealed.open(row.admin_token_enc!!, priv))
        val st = svc.status("h1")
        assertTrue(st.configured)
        assertEquals(true, st.adminTokenSet)
    }

    @Test fun `fails when public key missing`() {
        val db = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", "http://ha", "enc-op", null, "connected", t, t)
        }
        val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider)
        val ex = assertFailsWith<AppException> { svc.setAdminToken("h1", "u1", "tok") }
        assertEquals(503, ex.status)
    }

    @Test fun `the Home Assistant token is stored encrypted and kept when only the URL changes`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
        }
        val vault = alice.core.security.TokenVault.ephemeral()
        val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider, null, vault)
        svc.putConnection("h1", "u1", "HA", "http://ha.local:8123", "long-lived-token")
        fun stored() = db.read { identityQueries.selectHaConnectionByHousehold("h1").executeAsOne().operational_token_enc }
        assertTrue(vault.isSealed(stored()))
        assertEquals("long-lived-token", vault.open(stored()))
        svc.putConnection("h1", "u1", null, "http://other:8123", null)
        assertEquals("long-lived-token", vault.open(stored()))
    }
}
