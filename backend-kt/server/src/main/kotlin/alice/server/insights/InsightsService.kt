package alice.server.insights

import alice.core.db.Database
import alice.core.error.notFound
import alice.core.events.EventBus
import alice.core.events.InsightsChanged
import alice.core.time.TimeProvider
import alice.server.presence.PresenceService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

@Serializable
data class InsightAction(val type: String = "set_mode", val mode: String)

@Serializable
data class Insight(
    val id: String,
    val kind: String = "mode_suggestion",
    val title: String,
    val reason: String,
    val action: InsightAction,
    val key: String,
)

enum class TimeOfDay { morning, day, evening, night }

class InsightsService(
    private val db: Database,
    private val bus: EventBus,
    private val time: TimeProvider,
    private val presence: PresenceService? = null,
) {
    private val lastSeen = ConcurrentHashMap<String, String>()
    private val dismissForMs = 6L * 3_600_000L

    fun timezone(householdId: String): String = try {
        db.read { identityQueries.selectHouseholdById(householdId).executeAsOneOrNull() }?.timezone ?: "UTC"
    } catch (_: Throwable) { "UTC" }

    fun timeOfDay(householdId: String): Pair<TimeOfDay, String> {
        val tz = try { ZoneId.of(timezone(householdId)) } catch (_: Throwable) { ZoneId.of("UTC") }
        val now = Instant.ofEpochMilli(time.now()).atZone(tz)
        val hour = now.hour
        val label = String.format(Locale.US, "%d:%02d %s", ((hour + 11) % 12) + 1, now.minute, if (hour < 12) "am" else "pm")
        val tod = when {
            hour in 5..10 -> TimeOfDay.morning
            hour in 11..16 -> TimeOfDay.day
            hour in 17..21 -> TimeOfDay.evening
            else -> TimeOfDay.night
        }
        return tod to label
    }

    private fun householdMode(householdId: String): String =
        db.read { identityQueries.selectHouseholdSettings(householdId).executeAsOneOrNull() }?.mode ?: "home"

    fun list(householdId: String): List<Insight> {
        val mode = householdMode(householdId)
        val counts = try { runBlocking { presence?.countsAsync(householdId) } } catch (_: Throwable) { null }
        val total = counts?.first ?: 0
        val home = counts?.second ?: 0
        val (tod, label) = timeOfDay(householdId)

        val toReason = when {
            total > 0 && home == 0 && mode == "home" -> "away" to "Everyone has left."
            home > 0 && mode == "away" -> "home" to "Someone just got home."
            tod == TimeOfDay.night && mode == "home" -> "night" to "It is $label."
            tod == TimeOfDay.morning && mode == "night" -> "home" to "It is morning."
            else -> null
        } ?: return emptyList()
        val (toMode, reasonText) = toReason

        val key = "${toMode}|${tod.name.lowercase(Locale.US)}"
        val now = time.now()
        val dismissed = db.read { identityQueries.selectInsightDismissal(householdId, key).executeAsOneOrNull() }
        if (dismissed != null && dismissed.until > now) return emptyList()

        val title = when (toMode) {
            "away" -> "Switch to Away mode?"
            "night" -> "Switch to Night mode?"
            "home" -> "Switch to Home mode?"
            "vacation" -> "Switch to Vacation mode?"
            else -> "Switch mode?"
        }
        return listOf(Insight(id = "mode:${toMode}", title = title, reason = reasonText, action = InsightAction(mode = toMode), key = key))
    }

    fun suggestion(householdId: String, currentMode: String? = null): Insight? {
        // compatibility for existing callers; list() computes from current state/mode
        return list(householdId).firstOrNull()
    }

    fun dismiss(householdId: String, id: String) {
        val found = list(householdId).find { it.id == id } ?: throw notFound("Suggestion")
        val until = time.now() + dismissForMs
        db.write { identityQueries.upsertInsightDismissal(householdId, found.key, until) }
        tick(householdId)
    }

    fun tick(householdId: String) {
        val ids = list(householdId).joinToString(",") { it.id }
        if (lastSeen[householdId] == ids) return
        lastSeen[householdId] = ids
        bus.publish(InsightsChanged(householdId, time.now().toString()))
    }
}
