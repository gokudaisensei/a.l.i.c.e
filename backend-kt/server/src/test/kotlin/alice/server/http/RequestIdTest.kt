package alice.server.http

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.server.application.install
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class RequestIdTest {
    private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    @Test
    fun `valid request id is kept and reaches the call attribute`() = testApplication {
        application {
            install(RequestIdPlugin)
            routing { get("/id") { call.respondText(call.requestId()) } }
        }
        val id = "abc.DEF_123-:42"
        val response = client.get("/id") { header(REQUEST_ID_HEADER, id) }
        assertEquals(id, response.headers[REQUEST_ID_HEADER])
        assertEquals(id, response.bodyAsText())
    }

    @Test
    fun `invalid or absent request ids are replaced with a generated uuid`() = testApplication {
        application {
            install(RequestIdPlugin)
            routing { get("/id") { call.respondText(call.requestId()) } }
        }
        for (bad in listOf("x".repeat(65), "with space", "<script>alert(1)</script>", "", "abc\n123", "abc\u000B123")) {
            val generated = normalizeRequestId(bad)
            assertTrue(uuid.matches(generated), "expected UUID for ${bad.replace("\n", "\\n")}, got $generated")
            assertNotEquals(bad, generated)
        }
        val absent = client.get("/id")
        val absentId = absent.bodyAsText()
        assertTrue(uuid.matches(absentId), absentId)
        assertEquals(absentId, absent.headers[REQUEST_ID_HEADER])
    }
}
