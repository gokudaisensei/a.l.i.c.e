package alice.server.commands

import alice.core.ids.Ids
import alice.core.time.TimeProvider
import alice.ha.HomeAssistantGateway
import alice.ha.HaServiceCallResult
import alice.ha.NormalizedState
import alice.ha.StateCache
import alice.server.households.HouseholdService
import alice.core.error.AppException
import alice.core.error.validationError
import alice.server.permissions.SensitivityCheck
import alice.server.permissions.can
import alice.server.permissions.defaultSensitivityCheck
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Converts a plain Kotlin value to JSON without losing its type (unlike `toString()`, which quotes strings). */
internal fun anyToJsonElement(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is Boolean -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is String -> JsonPrimitive(v)
    is Map<*, *> -> JsonObject(v.entries.associate { it.key.toString() to anyToJsonElement(it.value) })
    is Iterable<*> -> JsonArray(v.map { anyToJsonElement(it) })
    else -> JsonPrimitive(v.toString())
}

class CommandExecutor(
    private val store: CommandStore,
    private val gateway: HomeAssistantGateway,
    private val stateCache: StateCache,
    private val households: HouseholdService,
    private val time: TimeProvider,
    private val eventBus: alice.core.events.EventBus? = null,
    private val smart: alice.server.smart.SmartService? = null,
    private val sensitivity: SensitivityCheck = defaultSensitivityCheck,
    private val activity: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
    private val things: Lazy<alice.server.things.ThingsService?> = lazyOf(null),
) {
    /**
     * One command at a time per entity. Commands for the same entity queue behind each other, so two toggles cannot
     * interleave; different entities run in parallel. A lane exists only while someone is using it.
     * A command waiting in a lane is dropped (state `cancelled`) when a newer command for the same entity and the same
     * "set it to X" action arrives before its turn, so moving a slider does not build a queue of stale values.
     */
    private class Lane {
        val mutex = kotlinx.coroutines.sync.Mutex()
        var users = 0 // changed only inside ConcurrentHashMap.compute
        val newest = ConcurrentHashMap<String, Long>()
    }

    private val lanes = ConcurrentHashMap<String, Lane>()
    private val tickets = java.util.concurrent.atomic.AtomicLong()

    private suspend fun <T> inLane(entityId: String, action: String, coalesce: Boolean, block: suspend (superseded: Boolean) -> T): T {
        val lane = lanes.compute(entityId) { _, existing -> (existing ?: Lane()).also { it.users++ } }!!
        val mine = tickets.incrementAndGet()
        if (coalesce) lane.newest[action] = mine
        try {
            return lane.mutex.withLock { block(coalesce && lane.newest[action] != mine) }
        } finally {
            lanes.computeIfPresent(entityId) { _, l -> if (--l.users == 0) null else l }
        }
    }

    /** Absolute commands ("set it to X") can be merged; toggles and the like cannot, since doing one twice differs from once. */
    private fun coalescable(input: CommandInput): Boolean =
        input.undoOf == null && (input.action.startsWith("set_") || input.action in ABSOLUTE_ACTIONS)

    internal fun laneCount(): Int = lanes.size

    private fun fingerprint(input: CommandInput): String {
        val payload = buildString {
            append(input.householdId).append('|').append(input.entityId).append('|').append(input.action).append('|')
            append(input.parameters.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" })
        }
        return MessageDigest.getInstance("SHA-256").digest(payload.toByteArray()).joinToString("") { "%02x".format(it) }
    }

    suspend fun execute(input: CommandInput): DeviceCommand {
        val userId = input.actor.userId ?: ""
        val key = input.idempotencyKey
        if (key != null) {
            val err = validateIdempotencyKey(key)
            if (err != null) throw validationError(err)
            val fp = fingerprint(input)
            val (existing, replay) = checkIdempotency(userId, key, fp)
            if (replay && existing != null) return existing
        }

        val cmd = inLane(input.entityId, input.action, coalescable(input)) { superseded ->
            if (superseded) supersede(input) else runCommand(input)
        }
        if (key != null) {
            runCatching { recordIdempotency(userId, key, fingerprint(input), cmd.id) }
        }
        return cmd
    }

    private fun newCommand(input: CommandInput): DeviceCommand {
        val domain = input.entityId.substringBefore('.')
        val now = time.now()
        val id = Ids.next("cmd")
        return DeviceCommand(
            id = id,
            householdId = input.householdId,
            connectionId = null,
            entityId = input.entityId,
            domain = domain,
            action = input.action,
            parameters = input.parameters,
            state = CommandState.PENDING,
            requestedState = expectationFor(domain, input.action, input.parameters, emptyMap())?.requested,
            actualState = null,
            requestedBy = input.actor.userId,
            source = input.actor.source,
            haContextId = null,
            failure = null,
            confirmedBy = null,
            createdAt = now,
            dispatchedAt = null,
            acceptedAt = null,
            finishedAt = null,
            timeoutAt = null,
            previousState = stateCache.get(input.entityId)?.normalized,
            undoOf = input.undoOf,
            undoneBy = null,
            groupId = input.groupId,
        )
    }

    /** A newer request for the same thing arrived while this one was waiting its turn, so this one never runs. */
    private fun supersede(input: CommandInput): DeviceCommand {
        val cmd = newCommand(input)
        store.create(cmd)
        store.update(cmd.id) { it.state = CommandState.CANCELLED; it.finishedAt = time.now() }
        return store.get(cmd.id)!!
    }

    private suspend fun runCommand(input: CommandInput): DeviceCommand {
        val domain = input.entityId.substringBefore('.')
        val cmd = newCommand(input)
        store.create(cmd)

        // Validate parameters
        val paramError = validateParameters(input.action, input.parameters)
        if (paramError != null) return fail(cmd, FailureCode.INVALID_PARAMETERS, paramError)

        // Authorize
        val membership = input.actor.userId?.let { households.getMembership(it) }
        if (input.actor.userId != null && membership == null) return fail(cmd, FailureCode.FORBIDDEN, "You are not part of this home")
        if (membership != null && !can(membership.role, "device.control")) return fail(cmd, FailureCode.FORBIDDEN, "Your role cannot control devices")

        // Step-up for sensitive operations
        val deviceClass = (stateCache.get(input.entityId)?.attributes?.get("device_class") as? JsonPrimitive)?.contentOrNull
        val sensitive = sensitivity(input.householdId, domain, input.action, deviceClass)
        if (sensitive && !input.actor.steppedUp) return fail(cmd, FailureCode.STEP_UP_REQUIRED, "Confirm with your passkey to continue")

        // Transition to authorized
        if (!canTransition(CommandState.PENDING, CommandState.AUTHORIZED)) return fail(cmd, FailureCode.INTERNAL, "bad transition")
        store.update(cmd.id) { it.state = CommandState.AUTHORIZED }

        // Resolve operation
        val op = alice.ha.resolveOperation(domain, input.action, input.parameters)
        if (op == null) return fail(cmd, FailureCode.UNSUPPORTED_OPERATION, "Unsupported operation")

        // Pre-dispatch availability resync
        val cached = stateCache.get(input.entityId)
        if (cached?.availability == "unavailable") return fail(cmd, FailureCode.DEVICE_UNAVAILABLE, "Device is unavailable")

        // Dispatch
        if (!canTransition(CommandState.AUTHORIZED, CommandState.DISPATCHED)) return fail(cmd, FailureCode.INTERNAL, "bad transition")
        store.update(cmd.id) { it.state = CommandState.DISPATCHED; it.dispatchedAt = time.now() }
        val haResult: HaServiceCallResult = try {
            gateway.callService(
                alice.ha.HaServiceCallInput(
                    op.domain,
                    op.service,
                    data = op.data.mapValues { (_, v) -> anyToJsonElement(v) },
                    // Without a target Home Assistant addresses no entity at all.
                    target = alice.ha.HaServiceTarget(entity_id = listOf(input.entityId)),
                ),
            )
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            return fail(cmd, FailureCode.HA_UNREACHABLE, e.message ?: "HA unreachable")
        }
        if (!canTransition(CommandState.DISPATCHED, CommandState.ACCEPTED)) return fail(cmd, FailureCode.INTERNAL, "bad transition")
        store.update(cmd.id) { it.state = CommandState.ACCEPTED; it.haContextId = haResult.contextId; it.acceptedAt = time.now() }

        // Confirm by desired state
        val exp = expectationFor(domain, input.action, input.parameters, cached?.normalized ?: emptyMap())
        if (exp == null) {
            if (!canTransition(CommandState.ACCEPTED, CommandState.CONFIRMED)) return fail(cmd, FailureCode.INTERNAL, "bad transition")
            store.update(cmd.id) { it.state = CommandState.CONFIRMED; it.confirmedBy = "unobservable"; it.finishedAt = time.now() }
            val c1 = store.get(cmd.id)!!
            publishCommandEvent("command.confirmed", c1)
            return c1
        }

        val timeout = input.confirmTimeoutMs ?: 5000L
        val deadline = time.now() + timeout
        store.update(cmd.id) { it.timeoutAt = deadline }
        while (time.now() < deadline) {
            val proj = stateCache.get(input.entityId)
            if (proj != null && exp.matches(proj.normalized)) {
                if (!canTransition(CommandState.ACCEPTED, CommandState.CONFIRMED)) return fail(cmd, FailureCode.INTERNAL, "bad transition")
                store.update(cmd.id) { it.state = CommandState.CONFIRMED; it.confirmedBy = "state"; it.actualState = proj.normalized; it.finishedAt = time.now() }
                val c2 = store.get(cmd.id)!!
                publishCommandEvent("command.confirmed", c2)
                return c2
            }
            kotlinx.coroutines.delay(50)
        }
        // Late confirmation: try once more
        val proj = stateCache.get(input.entityId)
        if (proj != null && exp.matches(proj.normalized)) {
            store.update(cmd.id) { it.state = CommandState.CONFIRMED; it.confirmedBy = "state"; it.actualState = proj.normalized; it.finishedAt = time.now() }
            val c3 = store.get(cmd.id)!!
            publishCommandEvent("command.confirmed", c3)
            return c3
        }
        if (!canTransition(CommandState.ACCEPTED, CommandState.TIMED_OUT)) return fail(cmd, FailureCode.INTERNAL, "bad transition")
        store.update(cmd.id) { it.state = CommandState.TIMED_OUT; it.finishedAt = time.now() }
        val c4 = store.get(cmd.id)!!
        publishCommandEvent("command.timed_out", c4)
        return c4
    }

    private fun publishCommandEvent(type: String, cmd: DeviceCommand) {
        eventBus?.publish(CommandAppEvent(type, cmd.householdId, cmd.copy()))
        if (type == "command.confirmed" && cmd.requestedBy != null) {
            runCatching { smart?.recordCommand(cmd.householdId, cmd.requestedBy, cmd.entityId) }
            if (cmd.confirmedBy != "already" && (cmd.source == CommandSource.USER || cmd.source == CommandSource.AI)) {
                alice.core.concurrent.runCatchingNonCancellation {
                    val act = activity.value ?: return@runCatchingNonCancellation
                    val name = things.value?.let { svc ->
                        kotlinx.coroutines.runBlocking { svc.findEntity(cmd.householdId, cmd.entityId)?.thing?.name }
                    } ?: cmd.entityId
                    val verb = when (cmd.action) {
                        "turn_on" -> "turned on"
                        "turn_off" -> "turned off"
                        "toggle" -> "toggled"
                        "lock" -> "locked"
                        "unlock" -> "unlocked"
                        "open" -> "opened"
                        "close" -> "closed"
                        "stop" -> "stopped"
                        "set_brightness" -> "set brightness on"
                        "set_temperature" -> "set temperature on"
                        "set_position" -> "set position on"
                        "set_color" -> "set color on"
                        "play" -> "played"
                        "pause" -> "paused"
                        else -> cmd.action.replace('_', ' ')
                    }
                    act.record(cmd.householdId, "device", cmd.requestedBy, cmd.connectionId, cmd.entityId, "$verb $name", dedupeWithinMs = 10_000L)
                }
            }
        }
    }

    private fun fail(cmd: DeviceCommand, code: FailureCode, message: String): DeviceCommand {
        store.update(cmd.id) { it.state = CommandState.FAILED; it.failure = code to message; it.finishedAt = time.now() }
        val updated = store.get(cmd.id)!!
        publishCommandEvent("command.failed", updated)
        return updated
    }

    suspend fun cancel(id: String): DeviceCommand? {
        val cmd = store.get(id) ?: return null
        if (isTerminal(cmd.state)) return cmd
        if (!canTransition(cmd.state, CommandState.CANCELLED)) return cmd
        store.update(id) { it.state = CommandState.CANCELLED; it.finishedAt = time.now() }
        return store.get(id)
    }

    /**
     * The inverse runs as the person who made the original command, so the device rules are checked for them now: a
     * deny added (or an allow removed) since the original must also stop its undo.
     */
    private suspend fun requesterMaySee(cmd: DeviceCommand): Boolean {
        val svc = things.value ?: return true // not wired (some tests); the HTTP route checks the person asking
        val userId = cmd.requestedBy ?: return false
        val membership = households.getMembership(userId)?.takeIf { it.householdId == cmd.householdId } ?: return false
        val found = svc.findEntity(cmd.householdId, cmd.entityId) ?: return false
        return svc.canSee(alice.server.things.Caller(cmd.householdId, userId, membership.role, false), found.connectionId, cmd.entityId, found.thing)
    }

    suspend fun undo(id: String, now: Long = time.now()): DeviceCommand? {
        val cmd = store.get(id) ?: return null
        val plan = undoPlan(cmd) ?: return null
        if (!isUndoable(cmd, now)) return null
        if (!requesterMaySee(cmd)) throw AppException(alice.core.error.ErrorCode.NOT_FOUND, "Command not found", 404)
        // Dispatch the inverse command
        val input = CommandInput(
            householdId = cmd.householdId,
            entityId = cmd.entityId,
            action = plan.first,
            parameters = (plan.second ?: emptyMap()).mapValues { (_, v) -> anyToJsonElement(v) },
            actor = Actor(cmd.requestedBy, CommandSource.USER, false),
            undoOf = cmd.id,
        )
        val inverse = execute(input)
        store.update(id) { it.undoneBy = inverse.id }
        smart?.recordUndo(cmd.householdId, cmd.requestedBy ?: "", cmd.entityId)
        return store.get(id)
    }

    // Idempotency
    fun validateIdempotencyKey(key: String): String? {
        if (!Regex("^[A-Za-z0-9_\\-:.]{8,80}$").matches(key)) return "The idempotency key must be 8 to 80 letters, digits or - _ : ."
        return null
    }

    fun checkIdempotency(userId: String, key: String, fingerprint: String): Pair<DeviceCommand?, Boolean> {
        val entry = store.findIdempotent(userId, key) ?: return null to false
        if (time.now() - entry.createdAt > IDEMPOTENCY_TTL_MS) return null to false
        if (entry.fingerprint != fingerprint) throw AppException("idempotency_key_reuse", "That key was already used for a different request", 422)
        val cmd = store.get(entry.commandId) ?: return null to false
        return cmd to true
    }

    fun recordIdempotency(userId: String, key: String, fingerprint: String, commandId: String) =
        store.saveIdempotent(userId, key, fingerprint, commandId, time.now())

    // Interrupted recovery
    fun recoverInterrupted(): Int {
        val now = time.now()
        store.purge(commandsBefore = now - COMMAND_RETENTION_MS, keysBefore = now - IDEMPOTENCY_TTL_MS)
        var count = 0
        for (cmd in store.list(null, null, null, 10000)) {
            if (!isTerminal(cmd.state)) {
                store.update(cmd.id) { it.state = CommandState.FAILED; it.failure = FailureCode.INTERRUPTED to "The server restarted before this command finished"; it.finishedAt = time.now() }
                count++
            }
        }
        return count
    }

    fun get(id: String): DeviceCommand? = store.get(id)

    fun list(filter: (CommandStore) -> List<DeviceCommand> = { it.list(null, null, null, 100) }): List<DeviceCommand> = filter(store)

    private companion object {
        const val IDEMPOTENCY_TTL_MS = 24 * 3_600_000L
        val ABSOLUTE_ACTIONS = setOf("turn_on", "turn_off", "lock", "unlock", "open", "close")
        const val COMMAND_RETENTION_MS = 30 * 24 * 3_600_000L
    }
}
