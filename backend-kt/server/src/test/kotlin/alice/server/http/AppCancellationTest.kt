package alice.server.http

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import alice.core.config.WebAuthnConfig
import alice.server.configure
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.CancellationException
import org.koin.dsl.koinApplication
import org.slf4j.LoggerFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AppCancellationTest {
    private fun app() = koinApplication {
        modules(
            alice.core.di.coreModule(
                AppConfig(
                    database = DatabaseConfig(path = ":memory:"),
                    webauthn = WebAuthnConfig(rpId = "localhost", origin = "http://localhost:3000"),
                ),
            ),
            alice.server.di.serverModule(),
        )
    }

    @Test
    fun `a cancelled request is not turned into a 500 or logged at error`() {
        val koinApp = app()
        val logger = LoggerFactory.getLogger("alice.server.http") as Logger
        val appender = ListAppender<ILoggingEvent>().apply { start() }
        logger.addAppender(appender)
        try {
            testApplication {
                application {
                    configure(koinApp.koin)
                    routing { get("/api/v1/cancel") { throw CancellationException("client went away") } }
                }
                val result = runCatching { client.get("/api/v1/cancel") }
                if (result.isSuccess) {
                    val response = result.getOrThrow()
                    val body = response.bodyAsText()
                    assertTrue(
                        response.status != HttpStatusCode.InternalServerError || !body.contains("Internal server error"),
                        "a cancellation must not become the 500 error envelope: ${response.status} $body",
                    )
                } else {
                    assertTrue(result.exceptionOrNull() is CancellationException, result.exceptionOrNull().toString())
                }
                assertTrue(appender.list.none { it.level == Level.ERROR }, appender.list.map { it.formattedMessage }.toString())
            }
        } finally {
            logger.detachAppender(appender)
            koinApp.close()
        }
    }

    @Test
    fun `a real unhandled error still gets the 500 envelope`() {
        val koinApp = app()
        try {
            testApplication {
                application {
                    configure(koinApp.koin)
                    routing { get("/api/v1/boom") { throw IllegalStateException("boom") } }
                }
                val response = client.get("/api/v1/boom")
                assertEquals(HttpStatusCode.InternalServerError, response.status)
            }
        } finally {
            koinApp.close()
        }
    }

    @Test
    fun `a request whose Home Assistant call times out gets the 500 envelope`() {
        val koinApp = app()
        try {
            testApplication {
                application {
                    configure(koinApp.koin)
                    // exactly what an unanswered Home Assistant call does: an expired withTimeout
                    routing { get("/api/v1/slow") { kotlinx.coroutines.withTimeout(20) { kotlinx.coroutines.delay(10_000) } } }
                }
                val response = client.get("/api/v1/slow")
                assertEquals(HttpStatusCode.InternalServerError, response.status)
                assertTrue(response.bodyAsText().contains("Internal server error"))
            }
        } finally {
            koinApp.close()
        }
    }
}
