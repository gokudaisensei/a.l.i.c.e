package alice.core.config

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class ConfigTest {

    @Test
    fun `defaults are usable with no configuration at all`() {
        val config = ConfigLoaderFactory.load()

        assertEquals("alice", config.app.name)
        assertEquals(3002, config.server.port)
        assertEquals("data/alice.db", config.database.path)
    }
}
