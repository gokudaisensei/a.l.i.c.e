package alice.server.commands

import alice.core.db.AliceDb
import alice.core.db.Commands
import alice.core.db.Database
import alice.core.error.AppException
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Commands and idempotency keys in SQLite, so history, undo and replays survive a restart. */
class SqlCommandStore(private val db: Database) : CommandStore {
    private val json = Json { ignoreUnknownKeys = true }
    private val paramsSerializer = MapSerializer(String.serializer(), JsonElement.serializer())

    override fun create(cmd: DeviceCommand) {
        db.write {
            identityQueries.insertCommand(
                cmd.id, cmd.householdId, cmd.connectionId, cmd.entityId, cmd.domain, cmd.action,
                json.encodeToString(paramsSerializer, cmd.parameters), cmd.state.wire,
                cmd.requestedState?.let(::encodeMap), cmd.actualState?.let(::encodeMap),
                cmd.requestedBy, cmd.source.wire, cmd.haContextId, cmd.failure?.first?.wire, cmd.failure?.second,
                cmd.confirmedBy, cmd.createdAt, cmd.dispatchedAt, cmd.acceptedAt, cmd.finishedAt, cmd.timeoutAt,
                cmd.previousState?.let(::encodeMap), cmd.undoOf, cmd.undoneBy, cmd.groupId,
            )
        }
    }

    override fun update(id: String, patch: (DeviceCommand) -> Unit): DeviceCommand = db.write {
        val row = identityQueries.selectCommandById(id).executeAsOneOrNull() ?: throw IllegalArgumentException("Unknown command $id")
        val cmd = row.toCommand()
        patch(cmd)
        identityQueries.updateCommandProgress(
            cmd.state.wire, cmd.actualState?.let(::encodeMap), cmd.haContextId, cmd.failure?.first?.wire, cmd.failure?.second,
            cmd.confirmedBy, cmd.dispatchedAt, cmd.acceptedAt, cmd.finishedAt, cmd.timeoutAt, cmd.undoneBy, id,
        )
        cmd
    }

    override fun get(id: String): DeviceCommand? = db.read { identityQueries.selectCommandById(id).executeAsOneOrNull()?.toCommand() }

    override fun list(householdId: String?, state: CommandState?, entityId: String?, limit: Int): List<DeviceCommand> =
        db.read { identityQueries.selectCommands(householdId, state?.wire, entityId, limit.toLong()).executeAsList().map { it.toCommand() } }

    override fun findIdempotent(userId: String, key: String): IdempotencyRecord? = db.read {
        identityQueries.selectIdempotencyKey(userId, key).executeAsOneOrNull()?.let { IdempotencyRecord(it.fingerprint, it.command_id, it.created_at) }
    }

    override fun saveIdempotent(userId: String, key: String, fingerprint: String, commandId: String, at: Long) {
        db.write { identityQueries.insertIdempotencyKey(userId, key, fingerprint, commandId, at) }
    }

    override fun purge(commandsBefore: Long, keysBefore: Long) {
        db.write {
            identityQueries.deleteFinishedCommandsBefore(commandsBefore)
            identityQueries.deleteExpiredIdempotencyKeys(keysBefore)
        }
    }

    /** Commands that were mid-flight when the process stopped. */
    fun unfinished(): List<DeviceCommand> = db.read { identityQueries.selectUnfinishedCommands().executeAsList().map { it.toCommand() } }

    private fun encodeMap(m: Map<String, Any?>): String = JsonObject(m.mapValues { (_, v) -> anyToJsonElement(v) }).toString()

    private fun decodeMap(s: String?): Map<String, Any?>? =
        s?.let { (json.parseToJsonElement(it) as? JsonObject)?.mapValues { (_, v) -> plainValue(v) } }

    private fun Commands.toCommand() = DeviceCommand(
        id = id, householdId = household_id, connectionId = connection_id, entityId = entity_id, domain = domain, action = action,
        parameters = parameters?.let { json.decodeFromString(paramsSerializer, it) } ?: emptyMap(),
        state = CommandState.fromWire(state) ?: throw AppException("data_error", "Unknown command state $state", 500),
        requestedState = decodeMap(requested_state), actualState = decodeMap(actual_state), requestedBy = requested_by,
        source = CommandSource.entries.first { it.wire == source }, haContextId = ha_context_id,
        failure = failure_code?.let { code -> (FailureCode.entries.firstOrNull { it.wire == code } ?: FailureCode.INTERNAL) to (failure_message ?: "") },
        confirmedBy = confirmed_by, createdAt = created_at, dispatchedAt = dispatched_at, acceptedAt = accepted_at,
        finishedAt = finished_at, timeoutAt = timeout_at, previousState = decodeMap(previous_state), undoOf = undo_of,
        undoneBy = undone_by, groupId = group_id,
    )
}

/** The plain Kotlin value behind a JSON element (numbers become Long when whole, else Double). */
internal fun plainValue(v: JsonElement): Any? = when (v) {
    is JsonPrimitive -> when {
        v is kotlinx.serialization.json.JsonNull -> null
        v.isString -> v.content
        else -> v.content.toBooleanStrictOrNull() ?: v.content.toLongOrNull() ?: v.content.toDoubleOrNull() ?: v.content
    }
    is kotlinx.serialization.json.JsonArray -> v.map { plainValue(it) }
    is JsonObject -> v.mapValues { plainValue(it.value) }
}
