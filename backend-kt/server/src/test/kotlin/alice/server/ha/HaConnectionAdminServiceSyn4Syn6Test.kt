package alice.server.ha

import alice.core.config.AppConfig
import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.error.AppException
import alice.core.security.TokenVault
import alice.core.time.SystemTimeProvider
import alice.server.sync.ConfigSyncService
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonNull
import java.net.InetSocketAddress
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class HaConnectionAdminServiceSyn4Syn6Test {
    private fun newDb(): Database = Database(DatabaseFactory.open(DatabaseFactory.MEMORY))

    private fun seed(db: Database, baseUrl: String = "http://127.0.0.1:1") {
        val t = System.currentTimeMillis()
        db.write {
            identityQueries.insertUser("u1", "U", t)
            identityQueries.insertHousehold("h1", "H", t)
            identityQueries.insertHaConnection("c1", "h1", "HA", baseUrl, "enc-op", null, "connected", t, t)
        }
    }

    private fun server(code: Int): HttpServer {
        val s = HttpServer.create(InetSocketAddress(0), 0)
        s.createContext("/") { ex ->
            ex.sendResponseHeaders(code, 0)
            ex.close()
        }
        s.start()
        return s
    }

    @Test
    fun `testConnection reports ok, 401 and 5xx correctly`() = runBlocking<Unit> {
        val okServer = server(200)
        val unauthorizedServer = server(401)
        val serverError = server(500)
        try {
            val db = newDb()
            seed(db, "http://127.0.0.1:${okServer.address.port}")
            val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
            val ok = svc.testConnection("h1")
            assertEquals(true, ok["ok"])
            assertEquals(200, ok["status"])
            assertEquals(true, ok["reachable"])
            assertNull(ok["error"])

            val db2 = newDb()
            seed(db2, "http://127.0.0.1:${unauthorizedServer.address.port}")
            val svc2 = HaConnectionAdminService(db2, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
            val unauthorized = svc2.testConnection("h1")
            assertEquals(false, unauthorized["ok"])
            assertEquals(401, unauthorized["status"])
            assertEquals(true, unauthorized["reachable"])
            assertEquals("Home Assistant rejected the access token", unauthorized["error"])

            val db3 = newDb()
            seed(db3, "http://127.0.0.1:${serverError.address.port}")
            val svc3 = HaConnectionAdminService(db3, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
            val failed = svc3.testConnection("h1")
            assertEquals(false, failed["ok"])
            assertEquals(500, failed["status"])
            assertEquals(false, failed["reachable"])
        } finally {
            okServer.stop(0)
            unauthorizedServer.stop(0)
            serverError.stop(0)
        }
    }

    @Test
    fun `testConnection does not open an invalid or non-http URL`() = runBlocking<Unit> {
        val db = newDb()
        seed(db, "file:///tmp/ha")
        val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
        val result = svc.testConnection("h1")
        assertEquals(false, result["ok"])
        assertEquals(false, result["reachable"])
        assertEquals("Home Assistant URL is not valid", result["error"])
    }

    @Test
    fun `testConnection reports connection refused`() = runBlocking<Unit> {
        val db = newDb()
        seed(db, "http://127.0.0.1:1")
        val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
        val result = svc.testConnection("h1")
        assertEquals(false, result["ok"])
        assertNull(result["status"])
        assertEquals(false, result["reachable"])
        assertNotNull(result["error"])
    }

    @Test
    fun `putConnection rejects non-http schemes and missing hosts`() {
        val db = newDb()
        seed(db)
        val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
        for (url in listOf("file:///tmp/ha", "ftp://example.com", "javascript:alert(1)", "http://", "not a url")) {
            val ex = assertFailsWith<AppException> { svc.putConnection("h1", "u1", "HA", url, "token") }
            assertEquals(400, ex.status)
        }
        svc.putConnection("h1", "u1", "HA", "https://example.com:8123", null)
    }

    @Test
    fun `resyncConnection returns false with an error when verification cannot run`() {
        val db = newDb()
        seed(db)
        val svc = HaConnectionAdminService(db, AppConfig(), SystemTimeProvider, null, TokenVault.ephemeral())
        val result = svc.resyncConnection("h1", "u1", null)
        assertEquals(false, result["ok"])
        assertEquals(false, result["triggered"])
        assertNotNull(result["error"])
    }
}
