package alice.server.ha

import alice.core.db.Database
import alice.core.events.EntityAvailabilityChanged
import alice.core.events.EntityRemoved
import alice.core.events.EntityStateChanged
import alice.core.events.EventBus
import alice.core.events.ThingsChanged
import alice.core.time.TimeProvider
import alice.ha.HaAuthError
import alice.ha.HaConnectionState
import alice.ha.HaStateChangedEvent
import alice.ha.HomeAssistantGateway
import alice.ha.StateCache
import alice.ha.SwitchableGateway
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

/**
 * Keeps the live Home Assistant connection running: connects (and reconnects with backoff), loads the
 * state cache, applies every state change to it, publishes the matching app events, and records the
 * connection's status in `ha_connections`.
 *
 * shortcut: one connection is live at a time (the first row), matching the rest of the app which
 * still resolves "the household" as the first one; make this a per-household map when that changes.
 */
class HaRuntime(
    private val database: Database,
    private val gateway: SwitchableGateway,
    private val stateCache: StateCache,
    private val events: EventBus,
    private val time: TimeProvider,
    private val vault: alice.core.security.TokenVault,
    private val factory: (baseUrl: String, token: String) -> HomeAssistantGateway = ::webSocketGateway,
    private val backoffMs: (attempt: Int) -> Long = ::defaultBackoff,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var job: Job? = null
    @Volatile private var activeId: String? = null
    @Volatile private var syncedAtValue: String? = null
    val lastSyncedAt: String? get() = syncedAtValue

    /** Start from whatever the database holds now. Safe to call again after the connection row changes. */
    @Synchronized
    fun start() {
        val row = database.read { identityQueries.selectAllHaConnections().executeAsList().firstOrNull() }
        if (row == null) { stop(); return }
        if (activeId == row.id && job?.isActive == true) return
        stop()
        activeId = row.id
        val token = vault.open(row.operational_token_enc)
        if (!vault.isSealed(row.operational_token_enc)) {
            // Stored in the clear by an older build: encrypt it in place.
            val now = time.now()
            database.write { identityQueries.updateHaConnection(row.name, row.base_url, vault.seal(token), now, row.id) }
        }
        job = scope.launch { run(row.id, row.household_id, row.base_url, token) }
    }

    /** Reconnect with the row as it is now (after its URL or token changed). */
    @Synchronized
    fun restart() { stop(); start() }

    @Synchronized
    fun stop() {
        if (activeId != null) stateCache.replaceAll(emptyList())
        syncedAtValue = null
        job?.cancel()
        job = null
        activeId = null
    }

    fun close() { stop(); scope.cancel() }

    private suspend fun run(id: String, householdId: String, baseUrl: String, token: String) {
        var attempt = 0
        while (scope.isActive) {
            val gw = factory(baseUrl, token)
            val dropped = kotlinx.coroutines.CompletableDeferred<Unit>()
            try {
                setStatus(id, "connecting", null, null)
                gw.onStatusChange { if (it == HaConnectionState.DISCONNECTED || it == HaConnectionState.ERROR) dropped.complete(Unit) }
                gw.connect()
                gw.subscribeStateChanges { ev -> onState(householdId, id, ev) }
                for (registry in alice.ha.HaWebSocketGateway.REGISTRY_EVENTS) {
                    gw.subscribeEvents(registry) {
                        events.publish(ThingsChanged(householdId = householdId, timestamp = time.now().toString(), reason = "registry"))
                    }
                }
                gateway.switchTo(gw)
                stateCache.replaceAll(gw.getStates())
                syncedAtValue = java.time.Instant.ofEpochMilli(time.now()).toString()
                val version = alice.core.concurrent.runCatchingNonCancellation { gw.getConfig()["version"] as? String }.getOrNull()
                setStatus(id, "connected", null, version)
                events.publish(ThingsChanged(householdId = householdId, timestamp = time.now().toString(), reason = "ha_connected"))
                attempt = 0
                dropped.await()
                log.warn("Home Assistant connection {} dropped", id)
                setStatus(id, "disconnected", "connection dropped", version)
            } catch (e: CancellationException) {
                runCatching { gw.disconnect() }
                throw e
            } catch (e: HaAuthError) {
                // A bad token will not fix itself: wait for the user to change it (start() runs again then).
                setStatus(id, "error", "Home Assistant rejected the access token", null)
                return
            } catch (e: Exception) {
                log.warn("Home Assistant connection {} failed: {}", id, e.message)
                setStatus(id, "error", e.message ?: e.javaClass.simpleName, null)
            }
            runCatching { gw.disconnect() }
            delay(backoffMs(attempt++))
        }
    }

    private fun onState(householdId: String, connectionId: String, ev: HaStateChangedEvent) {
        val now = time.now().toString()
        val new = ev.new_state
        stateCache.apply(new, ev.entity_id)
        if (new == null) {
            events.publish(EntityRemoved(householdId = householdId, timestamp = now, entityId = ev.entity_id))
            return
        }
        val projection = stateCache.get(ev.entity_id)
        events.publish(
            EntityStateChanged(
                householdId = householdId, timestamp = now, connectionId = connectionId, entityId = ev.entity_id,
                previousState = ev.old_state?.state, currentState = new.state,
                attributes = new.attributes, normalized = projection?.normalized ?: emptyMap(),
                lastChanged = new.last_changed, lastUpdated = new.last_updated,
            ),
        )
        if (ev.old_state != null && (ev.old_state!!.state == "unavailable") != (new.state == "unavailable")) {
            events.publish(EntityAvailabilityChanged(householdId = householdId, timestamp = now, entityId = ev.entity_id, availability = projection?.availability ?: "available"))
        }
    }

    private fun setStatus(id: String, status: String, error: String?, version: String?) {
        val now = time.now()
        runCatching {
            database.write {
                val row = identityQueries.selectHaConnectionById(id).executeAsOneOrNull() ?: return@write
                identityQueries.updateHaConnectionStatus(
                    status,
                    if (status == "connected") now else row.last_connected_at,
                    error,
                    version ?: row.ha_version,
                    now,
                    id,
                )
            }
        }.onFailure { log.debug("could not record connection status: {}", it.message) }
    }

    companion object {
        fun webSocketGateway(baseUrl: String, token: String): HomeAssistantGateway =
            alice.ha.HaWebSocketGateway.create(baseUrl, token)

        fun defaultBackoff(attempt: Int): Long =
            (1000L shl attempt.coerceAtMost(5)).coerceAtMost(30_000) + (Math.random() * 1000).toLong()
    }
}
