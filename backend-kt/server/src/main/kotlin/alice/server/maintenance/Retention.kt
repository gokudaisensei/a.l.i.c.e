package alice.server.maintenance

import alice.core.db.Database
import alice.core.time.TimeProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory
import java.util.concurrent.atomic.AtomicBoolean

/** Removes rows nothing will read again, so the tables that only ever grew stay a sensible size. */
class Retention(private val db: Database, private val time: TimeProvider) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val started = AtomicBoolean(false)

    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            while (isActive) {
                runCatching { run() }.onFailure { log.warn("retention run failed: {}", it.message) }
                delay(INTERVAL_MS)
            }
        }
    }

    fun stop() = scope.cancel()

    fun run() {
        val now = time.now()
        db.write {
            // A challenge is only meaningful until it expires, and it can hold an invitation code.
            identityQueries.deleteExpiredChallenges(now)
            identityQueries.deleteEndedSessionsBefore(now - 7 * DAY)
            identityQueries.deleteClosedInvitationsBefore(now - 30 * DAY)
            identityQueries.deleteReadNotificationsBefore(now - 90 * DAY, now - 365 * DAY)
            identityQueries.deleteClearedAlertsBefore(now - 90 * DAY)
            identityQueries.deleteAutomationRunsBefore(now - 90 * DAY)
        }
    }

    private companion object {
        const val DAY = 24 * 3_600_000L
        const val INTERVAL_MS = 6 * 3_600_000L
    }
}
