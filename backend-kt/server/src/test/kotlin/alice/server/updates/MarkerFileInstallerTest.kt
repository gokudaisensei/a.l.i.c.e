package alice.server.updates

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MarkerFileInstallerTest {
    @Test
    fun `the marker is valid JSON even when a value contains quotes`(@TempDir dir: Path) {
        val file = dir.resolve("update-requested.json")
        runBlocking { MarkerFileInstaller(file.toString()) { 42L }.request("1.2.3\"x", "install", "abc") }
        val json = Json.parseToJsonElement(file.toFile().readText()).jsonObject
        assertEquals("1.2.3\"x", json["version"]!!.jsonPrimitive.content)
        assertEquals("abc", json["artifactSha256"]!!.jsonPrimitive.content)
        assertEquals("42", json["requestedAt"]!!.jsonPrimitive.content)
    }

    @Test
    fun `no checksum is written as null`(@TempDir dir: Path) {
        val file = dir.resolve("m.json")
        runBlocking { MarkerFileInstaller(file.toString()).request("1.0.0", "rollback", null) }
        assertTrue(Json.parseToJsonElement(file.toFile().readText()).jsonObject["artifactSha256"] is JsonNull)
    }
}
