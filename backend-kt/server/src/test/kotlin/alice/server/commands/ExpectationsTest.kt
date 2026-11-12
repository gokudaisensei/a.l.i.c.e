package alice.server.commands

import alice.ha.NormalizedState
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ExpectationsTest {
    @Test
    fun `validateParameters catches missing and out-of-range`() {
        assertEquals("set_brightness needs \"brightness_pct\"", validateParameters("set_brightness", emptyMap()))
        assertEquals("\"brightness_pct\" must be between 1.0 and 100.0", validateParameters("set_brightness", mapOf("brightness_pct" to 200)))
        assertNull(validateParameters("set_brightness", mapOf("brightness_pct" to 50)))
        assertNull(validateParameters("turn_on", emptyMap()))
    }

    @Test
    fun `expectationFor turn_on matches power true`() {
        val e = expectationFor("light", "turn_on", emptyMap(), emptyMap())
        assertNotNull(e)
        assertTrue(e!!.matches(mapOf("power" to true)))
        assertEquals(mapOf("power" to true), e.requested)
    }

    @Test
    fun `expectationFor set_brightness tolerates rounding`() {
        val e = expectationFor("light", "set_brightness", mapOf("brightness_pct" to 30), emptyMap())
        assertNotNull(e)
        assertTrue(e!!.matches(mapOf("power" to true, "brightness" to 30)))
        assertTrue(e.matches(mapOf("power" to true, "brightness" to 31)))
    }

    @Test
    fun `undoPlan returns turn_off for turn_on when previously off`() {
        val cmd = DeviceCommand(
            id = "c1", householdId = "h", connectionId = null, entityId = "light.x", domain = "light",
            action = "turn_on", parameters = emptyMap(), state = CommandState.CONFIRMED,
            requestedState = null, actualState = null, requestedBy = "u", source = CommandSource.USER,
            haContextId = null, failure = null, confirmedBy = "state", createdAt = 0,
            dispatchedAt = null, acceptedAt = null, finishedAt = 1000, timeoutAt = null,
            previousState = mapOf("power" to false), undoOf = null, undoneBy = null,
        )
        assertEquals("turn_off" to null, undoPlan(cmd))
    }

    @Test
    fun `canTransition respects the state machine`() {
        assertTrue(canTransition(CommandState.PENDING, CommandState.AUTHORIZED))
        assertTrue(canTransition(CommandState.ACCEPTED, CommandState.CONFIRMED))
        assertTrue(!canTransition(CommandState.CONFIRMED, CommandState.PENDING))
        assertTrue(isTerminal(CommandState.CONFIRMED))
    }
}
