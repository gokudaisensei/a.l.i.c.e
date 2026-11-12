package alice.server.commands

import alice.core.db.Database
import alice.core.db.DatabaseFactory
import alice.core.time.SystemTimeProvider
import alice.ha.FakeGateway
import alice.ha.HaEntityState
import alice.ha.StateCache
import alice.server.households.HouseholdService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SqlCommandStoreTest {
    private fun seed(db: Database) = db.write {
        identityQueries.insertUser("u1", "A", 1)
        identityQueries.insertUserPreferences("u1")
        identityQueries.insertHousehold("h1", "Home", 1)
        identityQueries.insertHouseholdSettings("h1")
        identityQueries.insertHouseholdMember("m1", "h1", "u1", "admin", null, 1)
    }

    private fun command(id: String, at: Long, state: CommandState = CommandState.PENDING, entity: String = "light.x") = DeviceCommand(
        id = id, householdId = "h1", connectionId = null, entityId = entity, domain = "light", action = "set_brightness",
        parameters = mapOf("brightness_pct" to JsonPrimitive(40)), state = state,
        requestedState = mapOf("brightness" to 102L, "on" to true), actualState = null, requestedBy = "u1", source = CommandSource.USER,
        haContextId = null, failure = null, confirmedBy = null, createdAt = at, dispatchedAt = null, acceptedAt = null,
        finishedAt = null, timeoutAt = null, previousState = mapOf("brightness" to 10L, "on" to false), undoOf = null, undoneBy = null,
        groupId = "g1",
    )

    @Test
    fun `a command round-trips with its state maps, failure and group`() {
        val db = Database(DatabaseFactory.open(":memory:")); seed(db)
        val store = SqlCommandStore(db)
        store.create(command("c1", 100))
        val updated = store.update("c1") {
            it.state = CommandState.FAILED
            it.failure = FailureCode.HA_REJECTED to "nope"
            it.actualState = mapOf("brightness" to 12L)
            it.finishedAt = 200
        }
        assertEquals(CommandState.FAILED, updated.state)
        val got = store.get("c1")!!
        assertEquals(FailureCode.HA_REJECTED to "nope", got.failure)
        assertEquals(mapOf("brightness" to 12L), got.actualState)
        assertEquals(mapOf("brightness" to 102L, "on" to true), got.requestedState)
        assertEquals(mapOf("brightness" to 10L, "on" to false), got.previousState)
        assertEquals(JsonPrimitive(40), got.parameters["brightness_pct"])
        assertEquals("g1", got.groupId)
        assertNull(store.get("missing"))
    }

    @Test
    fun `list filters and orders newest first`() {
        val db = Database(DatabaseFactory.open(":memory:")); seed(db)
        val store = SqlCommandStore(db)
        store.create(command("c1", 1)); store.create(command("c2", 2, CommandState.CONFIRMED)); store.create(command("c3", 3, entity = "light.y"))
        assertEquals(listOf("c3", "c2", "c1"), store.list("h1").map { it.id })
        assertEquals(listOf("c2"), store.list("h1", CommandState.CONFIRMED).map { it.id })
        assertEquals(listOf("c3"), store.list(entityId = "light.y").map { it.id })
        assertEquals(1, store.list("h1", limit = 1).size)
        assertTrue(store.list("other").isEmpty())
    }

    @Test
    fun `purge removes old finished commands and old keys only`() {
        val db = Database(DatabaseFactory.open(":memory:")); seed(db)
        val store = SqlCommandStore(db)
        store.create(command("old-done", 1, CommandState.CONFIRMED)); store.create(command("old-live", 1, CommandState.DISPATCHED)); store.create(command("new-done", 500, CommandState.CONFIRMED))
        store.saveIdempotent("u1", "key-old", "fp", "old-done", 1); store.saveIdempotent("u1", "key-new", "fp", "new-done", 500)
        store.purge(commandsBefore = 100, keysBefore = 100)
        assertNull(store.get("old-done")); assertNotNull(store.get("old-live")); assertNotNull(store.get("new-done"))
        assertNull(store.findIdempotent("u1", "key-old")); assertNotNull(store.findIdempotent("u1", "key-new"))
    }

    @Test
    fun `commands, replays and recovery survive a restart`(@TempDir dir: Path) {
        val file = dir.resolve("alice.db").toString()
        fun executor(db: Database): CommandExecutor {
            val cache = StateCache().apply { replaceAll(listOf(HaEntityState("light.x", "off"))) }
            val gw = FakeGateway().apply { states.add(HaEntityState("light.x", "off")) }
            return CommandExecutor(SqlCommandStore(db), gw, cache, HouseholdService(db, SystemTimeProvider), SystemTimeProvider)
        }
        val firstId: String
        DatabaseFactory.open(file).let { handle ->
            val db = Database(handle); seed(db)
            val exec = executor(db)
            firstId = runBlocking { exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true), idempotencyKey = "retry-key-1")) }.id
            SqlCommandStore(db).create(command("stuck", System.currentTimeMillis(), CommandState.DISPATCHED))
            handle.close()
        }
        DatabaseFactory.open(file).use { handle ->
            val db = Database(handle)
            val exec = executor(db)
            assertNotNull(exec.get(firstId))
            val replay = runBlocking { exec.execute(CommandInput("h1", "light.x", "turn_on", emptyMap(), Actor("u1", CommandSource.USER, true), idempotencyKey = "retry-key-1")) }
            assertEquals(firstId, replay.id, "the same key must replay the stored command, not run it again")
            assertEquals(1, exec.recoverInterrupted())
            assertEquals(FailureCode.INTERRUPTED, exec.get("stuck")!!.failure!!.first)
        }
    }
}
