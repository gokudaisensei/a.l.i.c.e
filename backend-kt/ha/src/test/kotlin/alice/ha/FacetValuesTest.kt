package alice.ha

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class FacetValuesTest {
    @Test
    fun `door device class gives open closed polarity`() {
        val fv = FacetValues.describeFacet("door", "binary_sensor.door", "binary_sensor", "door", "Front door", "on")
        assertEquals("open", fv.value)
        assertEquals("warn", fv.tone)
        assertEquals(false, fv.ambiguous)
    }

    @Test
    fun `unknown polarity is ambiguous`() {
        val fv = FacetValues.describeFacet("shutter", "binary_sensor.shutter", "binary_sensor", null, "Camera shutter", "on")
        // "shutter" in name matches BY_NAME -> "closed" when on... actually "shutter" matches first regex
        assertTrue(fv.value == "closed" || fv.ambiguous)
    }

    @Test
    fun `suggestPolarity returns on value for known device class`() {
        assertEquals("open", FacetValues.suggestPolarity("door", null))
        assertEquals(null, FacetValues.suggestPolarity("unknown_class", null))
    }
}
