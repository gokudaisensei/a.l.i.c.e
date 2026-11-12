package alice.server.maintenance

import alice.core.db.Database
import alice.core.events.EventBus
import alice.core.time.TimeProvider
import alice.server.activity.ActivityService
import alice.server.insights.InsightsService
import alice.server.notifications.AlertsService
import alice.server.admin.AdminService
import alice.server.history.HistoryService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

/** Once a minute: left-open sweeps and insights per household, then pruning of the activity, audit and attribute logs. */
class HousekeepingScheduler(
    private val db: Database,
    private val bus: EventBus,
    private val time: TimeProvider,
    private val activity: ActivityService,
    private val alerts: AlertsService,
    private val insights: InsightsService,
    private val admin: AdminService,
    private val history: HistoryService,
    private val groups: Lazy<alice.server.groups.GroupsService?> = lazyOf(null),
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val started = java.util.concurrent.atomic.AtomicBoolean(false)

    fun stop() {
        scope.cancel()
    }

    /** Safe to call more than once (both the HTTP app module and `main` start it). */
    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            while (isActive) {
                alice.core.concurrent.runCatchingNonCancellation {
                    db.read { identityQueries.selectAllHouseholds().executeAsList() }.forEach { h ->
                        alice.core.concurrent.runCatchingNonCancellation { alerts.sweepLeftOpen(h.id) }
                        alice.core.concurrent.runCatchingNonCancellation { insights.tick(h.id) }
                        alice.core.concurrent.runCatchingNonCancellation { groups.value?.relinkStaleMembers(h.id) }
                    }
                    runCatching { activity.prune() }
                    runCatching { admin.pruneAudit() }
                    runCatching { admin.pruneAttributeLog() }
                }.onFailure { log.debug("housekeeping tick failed: {}", it.message) }
                delay(60_000)
            }
        }
    }
}
