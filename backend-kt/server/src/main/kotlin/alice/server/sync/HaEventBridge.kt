package alice.server.sync

import alice.core.db.Database
import alice.core.events.EventBus
import alice.core.events.PresenceChanged
import alice.core.time.TimeProvider
import alice.ha.HomeAssistantGateway
import alice.ha.HaStateChangedEvent
import alice.server.automations.AutomationsService
import alice.server.modes.ModesService
import alice.server.modes.MODE_HELPER_ENTITY
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import org.slf4j.LoggerFactory

/**
 * Bridges Home Assistant websocket events into Alice domain behavior.
 */
class HaEventBridge(
    private val gateway: HomeAssistantGateway,
    private val database: Database,
    private val events: EventBus,
    private val modes: ModesService,
    private val automations: AutomationsService,
    private val time: TimeProvider,
    private val activityRef: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
    private val alertsRef: Lazy<alice.server.notifications.AlertsService?> = lazyOf(null),
    private val notificationsRef: Lazy<alice.server.notifications.NotificationsService?> = lazyOf(null),
    private val insightsRef: Lazy<alice.server.insights.InsightsService?> = lazyOf(null),
    private val thingsRef: Lazy<alice.server.things.ThingsService?> = lazyOf(null),
    private val historyRef: Lazy<alice.server.history.HistoryService?> = lazyOf(null),
    private val applierRef: Lazy<ConfigJobApplier?> = lazyOf(null),
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var started = false
    @Volatile private var lastLogbookBackfillAt: Long = 0L

    private fun activity() = activityRef.value
    private fun alerts() = alertsRef.value
    private fun notifications() = notificationsRef.value
    private fun insights() = insightsRef.value

    // Everything keyed by connection (settings, alerts, things) still uses this one id; see audit SQL-8.
    private val APP_CONNECTION_ID = alice.ha.Connections.DEFAULT_ID

    private data class Target(val householdId: String, val connectionId: String)

    /** The household and connection the live gateway belongs to; without a configured connection, the first household. */
    private fun target(): Target? {
        database.read { identityQueries.selectAllHaConnections().executeAsList().firstOrNull() }
            ?.let { return Target(it.household_id, APP_CONNECTION_ID) }
        val h = database.read { identityQueries.selectAllHouseholds().executeAsList().firstOrNull() } ?: return null
        return Target(h.id, APP_CONNECTION_ID)
    }

    /** Stops this bridge's collectors and loops. Safe to call more than once. */
    fun stop() { scope.cancel() }

    fun start() {
        if (started) return
        started = true
        scope.launch {
            alice.core.concurrent.runCatchingNonCancellation {
                gateway.onStatusChange { st ->
                    if (st == alice.ha.HaConnectionState.CONNECTED) {
                        scope.launch { alice.core.concurrent.runCatchingNonCancellation { backfillLogbook() } }
                    }
                }
            }
            runCatching {
                gateway.subscribeStateChanges { ev ->
                    runCatching { handleStateChanged(ev) }
                        .onFailure { log.debug("state change handling failed: {}", it.message) }
                }
            }.onFailure { log.debug("state subscription unavailable: {}", it.message) }

            alice.core.concurrent.runCatchingNonCancellation {
                gateway.subscribeEvents("automation_triggered") { ev ->
                    runCatching { handleAutomationTriggered(ev) }
                        .onFailure { log.debug("automation trigger handling failed: {}", it.message) }
                }
            }.onFailure { log.debug("automation event subscription unavailable: {}", it.message) }

            alice.core.concurrent.runCatchingNonCancellation {
                gateway.subscribeEvents("alice_notification") { ev ->
                    runCatching { handleAliceNotification(ev.data) }
                        .onFailure { log.debug("alice_notification handling failed: {}", it.message) }
                }
            }.onFailure { log.debug("alice_notification subscription unavailable: {}", it.message) }

            val applier = applierRef.value
            if (applier != null) {
                launch {
                    while (true) {
                        // applyPending(null) applies every household that needs the in-process fallback.
                        alice.core.concurrent.runCatchingNonCancellation { applier.applyPending(null) }
                        delay(2000)
                    }
                }
            }
        }
    }

    private fun handleStateChanged(ev: HaStateChangedEvent) {
        val new = ev.new_state ?: return
        val oldState = ev.old_state?.state
        if (oldState == new.state) return
        val entityId = ev.entity_id
        val now = time.now().toString()
        val attrs = new.attributes.mapValues { (_, v) -> jsonToAny(v) }

        // L75: record Alice-side attribute samples (brightness/colour etc.) HA recorder may not keep
        runCatching {
            val domain = entityId.substringBefore('.')
            if (domain in setOf("light", "fan", "climate", "cover", "media_player")) {
                val hid = target()?.householdId
                if (hid != null) {
                    val norm = alice.ha.StateNormalizer.normalize(domain, new.state, new.attributes)
                    val keep = norm.filterKeys { it in setOf("brightness", "color_temperature", "color_mode", "fan_speed", "temperature", "target_temperature", "position") }
                        .filterValues { it != null }
                    if (keep.isNotEmpty()) {
                        val history = historyRef.value
                        history?.recordAttributes(hid, entityId, keep, time.now())
                    }
                }
            }
        }

        if (entityId.startsWith("person.")) {
            val links = database.read { identityQueries.selectAllPersonLinks().executeAsList() }
            val matching = links.filter { it.person_entity_id == entityId }
            val home = new.state == "home"
            if (matching.isEmpty()) {
                val h = target() ?: return
                events.publish(PresenceChanged(householdId = h.householdId, userId = null, personEntityId = entityId, home = home, timestamp = now))
            } else {
                matching.forEach { link ->
                    events.publish(PresenceChanged(householdId = link.household_id, userId = link.user_id, personEntityId = entityId, home = home, timestamp = now))
                    runCatching { insights()?.tick(link.household_id) }
                }
            }
            return
        }

        if (entityId == MODE_HELPER_ENTITY && new.state in setOf("home", "away", "night", "vacation")) {
            val households = database.read { identityQueries.selectAllHouseholds().executeAsList() }
            households.forEach { h ->
                runCatching {
                    val current = modes.get(h.id).mode
                    if (current != new.state) modes.set(h.id, null, new.state)
                }
            }
            return
        }

        val (householdId, connId) = target() ?: return

        if (entityId.startsWith("lock.") && oldState != null && (new.state == "locked" || new.state == "unlocked")) {
            alice.core.concurrent.runCatchingNonCancellation {
                val act = activity() ?: return@runCatchingNonCancellation
                val things = thingsRef.value
                val name = things?.let { svc -> kotlinx.coroutines.runBlocking { svc.findEntity(householdId, entityId)?.thing?.name } } ?: entityId
                act.record(householdId, "lock", null, connId, entityId, "$name ${new.state}", if (new.state == "unlocked") "warn" else "info", dedupeWithinMs = 15_000L)
            }
        }

        val deviceClass = attrs["device_class"]?.toString()
        if (deviceClass == "power") {
            val svc = alerts() ?: return
            scope.launch { alice.core.concurrent.runCatchingNonCancellation { svc.evaluatePower(householdId, connId, entityId, new.state, attrs) } }
        }

        if (isContactDomain(entityId, attrs)) {
            val svc = alerts() ?: return
            val open = isOpenState(entityId, new.state, attrs)
            if (!open) {
                scope.launch { alice.core.concurrent.runCatchingNonCancellation { svc.clearLeftOpenFor(householdId, connId, entityId) } }
            } else {
                scope.launch { alice.core.concurrent.runCatchingNonCancellation { svc.evaluateLeftOpen(householdId, connId, entityId, new.state, attrs, new.last_changed) } }
            }
        }
    }

    private fun isContactDomain(entityId: String, attrs: Map<String, Any?>): Boolean {
        val domain = entityId.substringBefore('.')
        if (domain == "cover") return true
        if (domain == "binary_sensor") {
            val dc = attrs["device_class"]?.toString() ?: return false
            return dc in setOf("door", "window", "garage_door", "opening")
        }
        return false
    }

    private fun isOpenState(entityId: String, state: String, attrs: Map<String, Any?>): Boolean {
        val domain = entityId.substringBefore('.')
        return when (domain) {
            "cover" -> state != "closed"
            "binary_sensor" -> state == "on"
            else -> false
        }
    }

    private fun handleAutomationTriggered(ev: alice.ha.HaRawEvent) {
        val entityId = ev.data["entity_id"]?.let { (it as? JsonPrimitive)?.contentOrNull } ?: return
        val source = ev.data["source"]?.let { (it as? JsonPrimitive)?.contentOrNull }
        val automationsAll = database.read { identityQueries.selectAllAutomations().executeAsList() }
        val match = automationsAll.firstOrNull { it.ha_entity_id == entityId } ?: return
        automations.recordRun(match.household_id, match.id, source)
        runCatching {
            activity()?.record(match.household_id, "automation", null, null, null, "The \u201C${match.name}\u201D automation ran")
        }
    }

    private fun handleAliceNotification(data: Map<String, kotlinx.serialization.json.JsonElement>) {
        val title = data["title"]?.let { (it as? JsonPrimitive)?.contentOrNull } ?: return
        val message = data["message"]?.let { (it as? JsonPrimitive)?.contentOrNull } ?: ""
        val userIds = (data["userIds"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        val hid = target()?.householdId ?: return
        val notif = notifications() ?: return
        val n = alice.server.notifications.NewNotification("automation", title, message)
        if (userIds.isNullOrEmpty()) notif.notifyHousehold(hid, n) else notif.notifyUsers(hid, userIds, n)
    }

    private suspend fun backfillLogbook() {
        val (householdId, connectionId) = target() ?: return
        val now = time.now()
        val from = if (lastLogbookBackfillAt > 0) lastLogbookBackfillAt - 60_000L else now - 6L * 60 * 60_000L
        lastLogbookBackfillAt = now
        val entries = alice.core.concurrent.runCatchingNonCancellation { gateway.getLogbook(from, now, null) }.getOrNull() ?: return
        val act = activity() ?: return
        for (e in entries) {
            val entityId = e.entity_id ?: e.context_entity_id ?: continue
            val whenMs = parseWhen(e.when_ts) ?: continue
            // lock state changes
            if (entityId.startsWith("lock.") && (e.state == "locked" || e.state == "unlocked" || (e.message ?: "").contains("locked", true) || (e.message ?: "").contains("unlocked", true))) {
                val st = when {
                    e.state == "locked" || e.state == "unlocked" -> e.state
                    (e.message ?: "").contains("unlocked", true) -> "unlocked"
                    (e.message ?: "").contains("locked", true) -> "locked"
                    else -> null
                } ?: continue
                val things = thingsRef.value
                val name = things?.let { svc -> kotlinx.coroutines.runBlocking { svc.findEntity(householdId, entityId)?.thing?.name } } ?: entityId
                act.record(householdId, "lock", null, connectionId, entityId, "$name $st", if (st == "unlocked") "warn" else "info", at = whenMs, dedupeWithinMs = 10 * 60_000L)
                continue
            }
            // automation triggered (best-effort)
            if (entityId.startsWith("automation.") && ((e.message ?: "").contains("triggered", true) || e.context_event_type == "automation_triggered")) {
                val name = database.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }
                    .firstOrNull { it.ha_entity_id == entityId }?.name ?: continue
                act.record(householdId, "automation", null, null, null, "The \u201C$name\u201D automation ran", at = whenMs, dedupeWithinMs = 10 * 60_000L)
            }
        }
    }

    private fun parseWhen(s: String?): Long? {
        if (s.isNullOrBlank()) return null
        return runCatching { java.time.Instant.parse(s).toEpochMilli() }.getOrNull()
            ?: s.toLongOrNull()
    }

    private fun jsonToAny(v: kotlinx.serialization.json.JsonElement): Any? = when (v) {
        is JsonPrimitive -> when {
            v.isString -> v.content
            v.booleanOrNull != null -> v.booleanOrNull
            v.doubleOrNull != null -> v.doubleOrNull
            v.content.toLongOrNull() != null -> v.content.toLong()
            else -> v.content
        }
        else -> v.toString()
    }
}
