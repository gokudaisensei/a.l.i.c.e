package alice.server.commands

import java.util.concurrent.ConcurrentHashMap

interface CommandStore {
    fun create(cmd: DeviceCommand)
    fun update(id: String, patch: (DeviceCommand) -> Unit): DeviceCommand
    fun get(id: String): DeviceCommand?
    fun list(householdId: String? = null, state: CommandState? = null, entityId: String? = null, limit: Int = 100): List<DeviceCommand>

    fun findIdempotent(userId: String, key: String): IdempotencyRecord?
    fun saveIdempotent(userId: String, key: String, fingerprint: String, commandId: String, at: Long)

    /** Drop finished commands created before [commandsBefore] and idempotency keys older than [keysBefore]. */
    fun purge(commandsBefore: Long, keysBefore: Long)
}

data class IdempotencyRecord(val fingerprint: String, val commandId: String, val createdAt: Long)

class InMemoryCommandStore : CommandStore {
    private val rows = ConcurrentHashMap<String, DeviceCommand>()
    private val keys = ConcurrentHashMap<Pair<String, String>, IdempotencyRecord>()

    override fun findIdempotent(userId: String, key: String) = keys[userId to key]
    override fun saveIdempotent(userId: String, key: String, fingerprint: String, commandId: String, at: Long) {
        keys[userId to key] = IdempotencyRecord(fingerprint, commandId, at)
    }
    override fun purge(commandsBefore: Long, keysBefore: Long) {
        rows.values.removeIf { isTerminal(it.state) && it.createdAt < commandsBefore }
        keys.values.removeIf { it.createdAt < keysBefore }
    }

    override fun create(cmd: DeviceCommand) { rows[cmd.id] = cmd.copy() }

    override fun update(id: String, patch: (DeviceCommand) -> Unit): DeviceCommand {
        val cur = rows[id] ?: throw IllegalArgumentException("Unknown command $id")
        val next = cur.copy()
        patch(next)
        rows[id] = next
        return next.copy()
    }

    override fun get(id: String): DeviceCommand? = rows[id]?.copy()

    override fun list(householdId: String?, state: CommandState?, entityId: String?, limit: Int): List<DeviceCommand> =
        rows.values.toList().reversed()
            .filter { (householdId == null || it.householdId == householdId) && (state == null || it.state == state) && (entityId == null || it.entityId == entityId) }
            .sortedByDescending { it.createdAt }
            .take(limit)
            .map { it.copy() }
}
