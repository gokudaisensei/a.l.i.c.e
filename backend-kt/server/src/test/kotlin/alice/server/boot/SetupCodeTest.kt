package alice.server.boot

import alice.server.announceSetupCode
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import org.slf4j.LoggerFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SetupCodeTest {
    @Test
    fun `generates and writes once only for production with no code and no users`() {
        repeat(20) {
            val written = mutableListOf<String>()
            val logger = LoggerFactory.getLogger("alice.server") as Logger
            val appender = ListAppender<ILoggingEvent>().apply { start() }
            logger.addAppender(appender)
            try {
                val code = announceSetupCode("production", hasSetupCode = false, needsSetup = true, generate = { "abc123" }) { written += it }
                assertEquals("abc123", code)
                assertEquals(1, written.size)
                assertTrue(written.single().contains("first person to register needs this setup code: abc123"))
                assertTrue(appender.list.none { it.formattedMessage.contains("abc123") })
            } finally {
                logger.detachAppender(appender)
            }
            assertNull(announceSetupCode("production", hasSetupCode = true, needsSetup = true) { error("must not write") })
            assertNull(announceSetupCode("production", hasSetupCode = false, needsSetup = false) { error("must not write") })
            assertNull(announceSetupCode("development", hasSetupCode = false, needsSetup = true) { error("must not write") })
        }
    }
}
