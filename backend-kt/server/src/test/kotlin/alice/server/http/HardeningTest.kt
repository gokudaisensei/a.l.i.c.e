package alice.server.http

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.ha.ConfigJobService
import alice.server.routes.forwardedClientIp
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.install
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HardeningTest {
    @Test
    fun `the client ip is the entry our proxy appended, not one the client made up`() {
        assertEquals("203.0.113.9", forwardedClientIp("1.2.3.4, 203.0.113.9"))
        assertEquals("203.0.113.9", forwardedClientIp(" 203.0.113.9 "))
        assertNull(forwardedClientIp(null)); assertNull(forwardedClientIp(" "))
    }

    @Test
    fun `a declared body over the limit is refused with 413`() = testApplication {
        application {
            install(BodyLimitPlugin) { maxBytes = 100 }
            install(StatusPages) { exception<alice.core.error.AppException> { call, e -> call.respond(HttpStatusCode.fromValue(e.status), e.message) } }
            routing { post("/echo") { call.respondText("ok") } }
        }
        assertEquals(HttpStatusCode.OK, client.post("/echo") { setBody("x".repeat(50)) }.status)
        assertEquals(HttpStatusCode.PayloadTooLarge, client.post("/echo") { setBody("x".repeat(500)) }.status)
    }

    @Test
    fun `a config job with the same key replaces only its own household's pending job`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        val t = 1L
        db.write {
            identityQueries.insertUser("u1", "A", t)
            for (h in listOf("h1", "h2")) {
                identityQueries.insertHousehold(h, h, t)
                identityQueries.insertHaConnection("c-$h", h, "HA", "http://ha", "tok", null, "connected", t, t)
            }
        }
        val jobs = ConfigJobService(db)
        val a = jobs.enqueue("h1", "voice.expose", "{}", "voice:light.x")!!
        val b = jobs.enqueue("h2", "voice.expose", "{}", "voice:light.x")!!
        val a2 = jobs.enqueue("h1", "voice.expose", "{}", "voice:light.x")!!
        assertNull(jobs.get(a), "h1's older job is replaced")
        assertEquals(b, jobs.get(b)?.let { b }, "h2's job is untouched")
        assertEquals(a2, jobs.get(a2)?.let { a2 })
    }
}
