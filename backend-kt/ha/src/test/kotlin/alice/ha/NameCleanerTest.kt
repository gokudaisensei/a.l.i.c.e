package alice.ha

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class NameCleanerTest {
    @Test
    fun `stripPrefix only strips whole words`() {
        assertEquals("Floor lamp", NameCleaner.stripPrefix("Kitchen Floor lamp", "Kitchen"))
        assertEquals("Kitchenette lamp", NameCleaner.stripPrefix("Kitchenette lamp", "Kitchen"))
        assertEquals("Kitchen", NameCleaner.stripPrefix("Kitchen", "Kitchen"))
    }

    @Test
    fun `scrub removes artifacts but keeps real numbers`() {
        assertEquals("outdoor temp", NameCleaner.scrub("outdoor_temp_2"))
        assertEquals("Light", NameCleaner.scrub("Light None"))
        assertEquals("Bedroom 10", NameCleaner.scrub("Bedroom 10"))
    }

    @Test
    fun `fixCase only touches single-case text and keeps acronyms`() {
        assertEquals("Outdoor Temp", NameCleaner.fixCase("outdoor temp"))
        assertEquals("Living Room TV", NameCleaner.fixCase("living room tv"))
        assertEquals("Living room", NameCleaner.fixCase("Living room"))
    }

    @Test
    fun `cleanEntityName drops device name HA prepends`() {
        assertEquals("Microphone mute", NameCleaner.cleanEntityName("Echo Show Microphone mute", "Microphone mute", true, "Echo Show", "Kitchen"))
    }

    @Test
    fun `cleanEntityName returns null when entity is the device`() {
        assertNull(NameCleaner.cleanEntityName("Echo Show", null, true, "Echo Show", "Kitchen"))
    }

    @Test
    fun `cleanEntityName strips device then area for entities without has_entity_name`() {
        assertEquals("Floor lamp", NameCleaner.cleanEntityName("Living room Floor lamp", null, false, null, "Living room"))
    }

    @Test
    fun `cleanThingName strips area prefix`() {
        assertEquals("Floor lamp", NameCleaner.cleanThingName("Living room Floor lamp", "Living room"))
        assertEquals("Echo Show", NameCleaner.cleanThingName("Echo Show", "Kitchen"))
    }

    @Test
    fun `buildAliases includes area-qualified and synonym phrases`() {
        val a = NameCleaner.buildAliases("Floor lamp", "Living room", "light")
        assertTrue(a.contains("floor lamp"))
        assertTrue(a.contains("living room floor lamp"))
        assertTrue(a.contains("living room bulb"))
        assertTrue(!a.contains("living room lamp"))
    }

    @Test
    fun `cleaning 100000 names stays fast`() {
        val inputs = listOf("Kitchen Floor lamp 2", "Living room TV", "outdoor_temp_10", "None", "Bedroom 9")
        val started = System.nanoTime()
        repeat(100_000) { i -> NameCleaner.cleanThingName(inputs[i % inputs.size], "Kitchen") }
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        assertTrue(elapsedMs < 5_000, "100000 cleanThingName calls took ${elapsedMs}ms")
    }

    @Test
    fun `regexes are compiled once at file level`() {
        val file = File("src/main/kotlin/alice/ha/NameCleaner.kt")
        assertTrue(file.isFile, "expected ${file.absolutePath}")
        val offending = file.readLines().withIndex().filter { (_, line) ->
            line.contains("Regex(") && !line.trimStart().startsWith("val ") && !line.trimStart().startsWith("private val ")
        }
        assertFalse(offending.isNotEmpty(), "Regex compiled inside a function: $offending")
    }
}
