package alice.ha

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ThingBuilderTest {
    private val things = ThingBuilder.buildThings(homeInventory(), "c1")
    private fun byName(n: String) = things.first { it.name == n }

    @Test
    fun `echo show is one thing with media player primary and camera as other`() {
        val echo = byName("Echo Show")
        assertEquals("media_player.echo_show", echo.primary?.entityId)
        assertEquals(listOf("camera.echo_show_camera"), echo.others.map { it.entityId }.sorted())
        assertEquals(ThingKind.device, echo.kind)
        assertEquals("kitchen", echo.areaId)
    }

    @Test
    fun `mic mute and volume are controls with clean names`() {
        val echo = byName("Echo Show")
        assertEquals(listOf("number.echo_show_volume", "switch.echo_show_microphone_mute"), echo.controls.map { it.entityId }.sorted())
        assertEquals(listOf("Microphone mute", "Volume"), echo.controls.map { it.name }.sorted())
    }

    @Test
    fun `camera shutter is a facet attached to the primary`() {
        val echo = byName("Echo Show")
        assertEquals(1, echo.facets.size)
        val shutter = echo.facets[0]
        assertEquals("binary_sensor.echo_show_camera_shutter", shutter.entityId)
        assertEquals("privacy_shutter", shutter.key) // key is not stored on ThingEntity in Kotlin port? 
    }

    @Test
    fun `thing ids are stable across rebuilds and distinct per connection`() {
        val a = ThingBuilder.buildThings(homeInventory(), "c1").map { it.id }
        assertEquals(a, ThingBuilder.buildThings(homeInventory(), "c1").map { it.id })
        assertTrue(ThingBuilder.buildThings(homeInventory(), "c2").map { it.id } != a)
    }

    @Test
    fun `bulbs stay separate things linked to their hub`() {
        val bridge = byName("Hue Bridge")
        assertEquals(bridge.id, byName("Floor lamp").hubThingId)
        assertEquals(bridge.id, byName("Ceiling lights").hubThingId)
        assertEquals(null, bridge.hubThingId)
    }

    @Test
    fun `a plug switch is promoted to primary`() {
        val plug = byName("Kettle plug")
        assertEquals("switch.kettle_plug", plug.primary?.entityId)
        assertEquals(EntityRole.primary, plug.primary?.role)
    }
}
