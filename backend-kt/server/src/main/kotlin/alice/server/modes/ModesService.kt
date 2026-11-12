package alice.server.modes

import alice.core.db.Database
import alice.core.error.validationError
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.server.households.HouseholdService
import kotlinx.serialization.Serializable

val HOUSEHOLD_MODES = listOf("home", "away", "night", "vacation")

data class ModeState(
    val mode: String,
    val changedAt: Long?,
    val changedBy: String?,
)

class ModesService(
    private val database: Database,
    private val time: TimeProvider,
    private val bus: alice.core.events.EventBus? = null,
    private val mirror: ModeMirrorService? = null,
    private val activity: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
    private val insights: Lazy<alice.server.insights.InsightsService?> = lazyOf(null),
) {
    fun get(householdId: String): ModeState {
        val s = database.read { identityQueries.selectHouseholdSettings(householdId).executeAsOneOrNull() }
        return ModeState(s?.mode ?: "home", s?.mode_changed_at, s?.mode_changed_by)
    }

    fun set(householdId: String, userId: String?, mode: String): ModeState {
        if (mode !in HOUSEHOLD_MODES) throw validationError("Mode must be one of ${HOUSEHOLD_MODES.joinToString(", ")}")
        val current = get(householdId)
        if (current.mode == mode) return current
        val t = time.now()
        database.write {
            identityQueries.updateHouseholdMode(mode, t, userId, householdId)
        }
        Audit.write(database, action = "household.mode_changed", householdId = householdId, actorId = userId, now = t)
        bus?.publish(alice.core.events.HouseholdModeChanged(householdId = householdId, mode = mode, previous = current.mode, changedBy = userId))
        runCatching {
            val act = activity.value
            val label = mode.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
            act?.record(householdId, "mode", userId, null, null, "switched to $label mode")
            insights.value?.tick(householdId)
        }
        mirror?.ensureHelper(householdId)
        // best-effort push (fire-and-forget in sync context)
        try { kotlinx.coroutines.runBlocking { mirror?.push(householdId, mode) } } catch (_: Throwable) {}
        return get(householdId)
    }
}
