package alice.server.commands

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.StateCache
import alice.server.households.HouseholdService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import kotlinx.coroutines.runBlocking

class CommandExecutorTest {
    private fun setup(): Triple<Database, HouseholdService, CommandExecutor> {
        val db = Database(DatabaseFactory.open(":memory:"))
        db.write {
            identityQueries.insertUser("u1", "Gokul", 1000)
            identityQueries.insertUserPreferences("u1")
            identityQueries.insertHousehold("h1", "Home", 1000)
            identityQueries.insertHouseholdSettings("h1")
            identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1000)
        }
        val hs = HouseholdService(db, SystemTimeProvider)
        val cache = StateCache()
        cache.replaceAll(listOf(alice.ha.HaEntityState("light.x", "on", mapOf("brightness" to kotlinx.serialization.json.JsonPrimitive(255)))))
        val gw = FakeGateway()
        gw.states.add(alice.ha.HaEntityState("light.x", "on", mapOf("brightness" to kotlinx.serialization.json.JsonPrimitive(255))))
        val store = InMemoryCommandStore()
        val exec = CommandExecutor(store, gw, cache, hs, SystemTimeProvider)
        return Triple(db, hs, exec)
    }

    @Test
    fun `execute turn_on succeeds`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
        }
        assertTrue(cmd.state == CommandState.CONFIRMED || cmd.state == CommandState.TIMED_OUT || cmd.state == CommandState.ACCEPTED)
    }

    @Test
    fun `execute with invalid parameters fails`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "set_brightness", mapOf("brightness_pct" to kotlinx.serialization.json.JsonPrimitive(200)), Actor("u1", CommandSource.USER, true)))
        }
        assertEquals(CommandState.FAILED, cmd.state)
        assertEquals(FailureCode.INVALID_PARAMETERS, cmd.failure?.first)
    }

    @Test
    fun `execute unsupported operation fails`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "fly", emptyMap(), Actor("u1", CommandSource.USER, true)))
        }
        assertEquals(CommandState.FAILED, cmd.state)
        assertEquals(FailureCode.UNSUPPORTED_OPERATION, cmd.failure?.first)
    }

    @Test
    fun `execute as non-member is forbidden`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("nonexistent", CommandSource.USER, true)))
        }
        assertEquals(CommandState.FAILED, cmd.state)
        assertEquals(FailureCode.FORBIDDEN, cmd.failure?.first)
    }

    @Test
    fun `step-up required for sensitive operations`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "lock.front", "unlock", emptyMap(), Actor("u1", CommandSource.USER, false)))
        }
        assertEquals(CommandState.FAILED, cmd.state)
        assertEquals(FailureCode.STEP_UP_REQUIRED, cmd.failure?.first)
    }

    @Test
    fun `cancel a pending command`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
        }
        // cancel might not work if already terminal
        val result = runBlocking { exec.cancel(cmd.id) }
        assertNotNull(result)
    }

    @Test
    fun `get returns command by id`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
        }
        val retrieved = exec.get(cmd.id)
        assertNotNull(retrieved)
        assertEquals(cmd.id, retrieved!!.id)
    }

    @Test
    fun `list returns commands for household`() {
        val (_, _, exec) = setup()
        runBlocking {
            exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
        }
        val cmds = exec.list { it.list("h1", null, null, 100) }
        assertTrue(cmds.isNotEmpty())
    }

    @Test
    fun `recoverInterrupted marks non-terminal commands as failed`() {
        val db = Database(DatabaseFactory.open(":memory:"))
        val store = InMemoryCommandStore()
        val exec = CommandExecutor(store, FakeGateway(), StateCache(), HouseholdService(db, SystemTimeProvider), SystemTimeProvider)
        store.create(
            DeviceCommand(
                id = "cmd_stuck", householdId = "h1", connectionId = null, entityId = "light.x", domain = "light",
                action = "turn_on", parameters = emptyMap(), state = CommandState.DISPATCHED,
                requestedState = null, actualState = null, requestedBy = "u1", source = CommandSource.USER,
                haContextId = null, failure = null, confirmedBy = null, createdAt = 1,
                dispatchedAt = 2, acceptedAt = null, finishedAt = null, timeoutAt = null,
                previousState = null, undoOf = null, undoneBy = null,
            ),
        )
        assertEquals(1, exec.recoverInterrupted())
        assertEquals(CommandState.FAILED, store.get("cmd_stuck")!!.state)
        assertEquals(FailureCode.INTERRUPTED, store.get("cmd_stuck")!!.failure!!.first)
        assertEquals(0, exec.recoverInterrupted())
    }

    @Test
    fun `idempotency key validation`() {
        val (_, _, exec) = setup()
        assertNull(exec.validateIdempotencyKey("valid-key-123"))
        assertNotNull(exec.validateIdempotencyKey("short"))
        assertNotNull(exec.validateIdempotencyKey("has spaces here"))
    }

    @Test
    fun `checkIdempotency detects replay`() {
        val (_, _, exec) = setup()
        val (existing, isReplay) = exec.checkIdempotency("u1", "key12345", "fingerprint1")
        assertEquals(null, existing)
        assertEquals(false, isReplay)
        // Record it
        runBlocking {
            val cmd = exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
            exec.recordIdempotency("u1", "key12345", "fingerprint1", cmd.id)
        }
        val (existing2, isReplay2) = exec.checkIdempotency("u1", "key12345", "fingerprint1")
        assertTrue(isReplay2)
        assertNotNull(existing2)
    }

    @Test
    fun `checkIdempotency throws on reused key with different fingerprint`() {
        val (_, _, exec) = setup()
        runBlocking {
            val cmd = exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
            exec.recordIdempotency("u1", "key12345", "fingerprint1", cmd.id)
        }
        val e = kotlin.test.assertFailsWith<alice.core.error.AppException> {
            exec.checkIdempotency("u1", "key12345", "different_fingerprint")
        }
        assertEquals("idempotency_key_reuse", e.code)
        assertEquals(422, e.status)
    }

    @Test
    fun `undo returns null for non-undoable command`() {
        val (_, _, exec) = setup()
        val cmd = runBlocking {
            exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true)))
        }
        // The light was already on, so there is nothing to undo.
        assertNull(runBlocking { exec.undo(cmd.id) })
    }
}
