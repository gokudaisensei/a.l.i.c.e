package alice.core.security

import alice.core.config.AppConfig
import alice.core.config.DatabaseConfig
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class TokenVaultTest {
    @Test
    fun `sealed values round-trip and differ every time`() {
        val v = TokenVault.ephemeral()
        val a = v.seal("secret-token"); val b = v.seal("secret-token")
        assertNotEquals(a, b)
        assertTrue(v.isSealed(a)); assertEquals("secret-token", v.open(a))
        assertFalse(a.contains("secret-token"))
    }

    @Test
    fun `a plaintext value, even a JWT with dots, reads back unchanged`() {
        val v = TokenVault.ephemeral()
        val jwt = "eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJhYmMifQ.c2lnbmF0dXJl"
        assertFalse(v.isSealed(jwt)); assertEquals(jwt, v.open(jwt))
    }

    @Test
    fun `another key cannot open a sealed value`() {
        val sealed = TokenVault.ephemeral().seal("x")
        kotlin.test.assertFails { TokenVault.ephemeral().open(sealed) }
    }

    @Test
    fun `without a configured key a key file is created once and reused`(@TempDir dir: Path) {
        val cfg = AppConfig(database = DatabaseConfig(path = dir.resolve("alice.db").toString()))
        val sealed = TokenVault.resolve(cfg).seal("x")
        assertTrue(Files.exists(dir.resolve("secrets.key")))
        assertEquals("x", TokenVault.resolve(cfg).open(sealed))
    }

    @Test
    fun `a configured key wins over the key file`(@TempDir dir: Path) {
        val key = java.util.Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() })
        val cfg = AppConfig(database = DatabaseConfig(path = dir.resolve("alice.db").toString()), secretsKey = key)
        TokenVault.resolve(cfg).seal("x")
        assertFalse(Files.exists(dir.resolve("secrets.key")))
    }

    @Test
    fun `processes starting together all end up with the same key`(@TempDir dir: Path) {
        val cfg = AppConfig(database = DatabaseConfig(path = dir.resolve("alice.db").toString()))
        val start = java.util.concurrent.CountDownLatch(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(8)
        val sealed = (1..8).map { pool.submit<String> { start.await(); TokenVault.resolve(cfg).seal("shared") } }
        start.countDown()
        val values = sealed.map { it.get() }
        pool.shutdown()
        val reader = TokenVault.resolve(cfg)
        values.forEach { assertEquals("shared", reader.open(it)) }
    }
}
