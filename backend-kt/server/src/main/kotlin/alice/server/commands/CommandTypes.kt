package alice.server.commands

import kotlinx.serialization.Serializable
import alice.core.events.AppEvent
import kotlinx.serialization.json.JsonElement

enum class CommandState(val wire: String) {
    PENDING("pending"),
    AUTHORIZED("authorized"),
    DISPATCHED("dispatched"),
    ACCEPTED("accepted"),
    CONFIRMED("confirmed"),
    FAILED("failed"),
    TIMED_OUT("timed_out"),
    CANCELLED("cancelled"),
    ;
    companion object {
        fun fromWire(value: String): CommandState? = entries.firstOrNull { it.wire == value }
    }
}

val TERMINAL_STATES: Set<CommandState> = setOf(CommandState.CONFIRMED, CommandState.FAILED, CommandState.TIMED_OUT, CommandState.CANCELLED)

fun isTerminal(s: CommandState): Boolean = s in TERMINAL_STATES

fun canTransition(from: CommandState, to: CommandState): Boolean {
    val allowed = when (from) {
        CommandState.PENDING -> setOf(CommandState.AUTHORIZED, CommandState.FAILED, CommandState.CANCELLED)
        CommandState.AUTHORIZED -> setOf(CommandState.DISPATCHED, CommandState.FAILED, CommandState.CANCELLED)
        CommandState.DISPATCHED -> setOf(CommandState.ACCEPTED, CommandState.FAILED, CommandState.TIMED_OUT)
        CommandState.ACCEPTED -> setOf(CommandState.CONFIRMED, CommandState.FAILED, CommandState.TIMED_OUT)
        else -> emptySet()
    }
    return to in allowed
}

class InvalidTransitionException(from: CommandState, to: CommandState) : IllegalStateException("Invalid command transition: $from -> $to")

enum class CommandSource(val wire: String) { USER("user"), AUTOMATION("automation"), AI("ai"), JOB("job") }

data class Actor(val userId: String?, val source: CommandSource, val steppedUp: Boolean = false)

data class CommandInput(
    val householdId: String,
    val entityId: String,
    val action: String,
    val parameters: Map<String, JsonElement> = emptyMap(),
    val actor: Actor,
    val undoOf: String? = null,
    val confirmTimeoutMs: Long? = null,
    val groupId: String? = null,
    val idempotencyKey: String? = null,
)

enum class FailureCode(val wire: String) {
    UNKNOWN_ENTITY("unknown_entity"),
    UNSUPPORTED_OPERATION("unsupported_operation"),
    FORBIDDEN("forbidden"),
    STEP_UP_REQUIRED("step_up_required"),
    INVALID_PARAMETERS("invalid_parameters"),
    DEVICE_UNAVAILABLE("device_unavailable"),
    HA_REJECTED("ha_rejected"),
    HA_UNREACHABLE("ha_unreachable"),
    NOT_CONFIRMED("not_confirmed"),
    INTERRUPTED("interrupted"),
    INTERNAL("internal"),
}

data class DeviceCommand(
    val id: String,
    val householdId: String,
    val connectionId: String?,
    val entityId: String,
    val domain: String,
    val action: String,
    val parameters: Map<String, JsonElement>,
    var state: CommandState,
    val requestedState: Map<String, Any?>?,
    var actualState: Map<String, Any?>?,
    val requestedBy: String?,
    val source: CommandSource,
    var haContextId: String?,
    var failure: Pair<FailureCode, String>?,
    var confirmedBy: String?,
    val createdAt: Long,
    var dispatchedAt: Long?,
    var acceptedAt: Long?,
    var finishedAt: Long?,
    var timeoutAt: Long?,
    val previousState: Map<String, Any?>?,
    val undoOf: String?,
    var undoneBy: String?,
    val groupId: String? = null,
)

@Serializable
data class PublicCommand(
    val id: String,
    val entityId: String,
    val action: String,
    val parameters: Map<String, JsonElement>,
    val state: String,
    val requestedState: Map<String, JsonElement>?,
    val actualState: Map<String, JsonElement>?,
    val requestedBy: String?,
    val source: String,
    val failure: PublicFailure?,
    val confirmedBy: String?,
    val createdAt: Long,
    val dispatchedAt: Long?,
    val acceptedAt: Long?,
    val finishedAt: Long?,
    val timeoutAt: Long?,
    val undoable: Boolean,
    val undoOf: String?,
    val undoneBy: String?,
)

@Serializable
data class PublicFailure(val code: String, val message: String)



/** Command event carrying the full command for realtime delivery. */
data class CommandAppEvent(
    override val type: String,
    override val householdId: String?,
    val command: DeviceCommand,
) : AppEvent
