package alice.server.realtime

import alice.core.events.ActivityRecorded
import alice.core.events.AlertCleared
import alice.core.events.AlertCreated
import alice.core.events.AppEvent
import alice.core.events.ConnectionConnected
import alice.core.events.ConnectionDisconnected
import alice.core.events.EntityAvailabilityChanged
import alice.core.events.EntityRemoved
import alice.core.events.EntityStateChanged
import alice.core.events.EventBus
import alice.core.events.HouseholdModeChanged
import alice.core.events.InsightsChanged
import alice.core.events.InventorySynced
import alice.core.events.NotificationCreated
import alice.core.events.PresenceChanged
import alice.core.events.ThingsChanged
import alice.core.time.TimeProvider
import alice.ha.EntityAvailabilityChangedEvent
import alice.ha.EntityRemovedEvent
import alice.ha.EntityStateChangedEvent
import alice.ha.RegistryUpdatedEvent
import alice.ha.StateCache
import alice.ha.Thing
import alice.ha.ThingEntity
import alice.server.auth.AuthService
import alice.server.auth.SessionContext
import alice.server.commands.CommandAppEvent
import alice.server.commands.toPublicCommand
import alice.server.households.HouseholdService
import alice.server.households.Membership
import alice.server.households.Role
import alice.server.permissions.can
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap

interface ClientSocket {
    val id: String
    suspend fun send(msg: JsonObject)
    suspend fun close(code: Int, reason: String)
    fun bufferedAmount(): Int
}

internal data class Queued(val type: String, val data: JsonElement?, val coalesceKey: String? = null)

internal class WsClient(
    val socket: ClientSocket,
    val userId: String,
    val sessionId: String,
    val householdId: String,
    @Volatile var role: String,
    @Volatile var checkedAt: Long,
    val subs: MutableSet<String> = java.util.Collections.synchronizedSet(mutableSetOf()),
) {
    val queue: MutableList<Queued> = java.util.Collections.synchronizedList(mutableListOf())
}

private data class Located(val thing: Thing, val entity: ThingEntity)

class RealtimeHub(
    private val bus: EventBus,
    private val households: HouseholdService,
    private val auth: AuthService? = null,
    private val things: ThingsService? = null,
    private val stateCache: StateCache? = null,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true },
    private val sweepMs: Long = SWEEP_MS,
    private val sendTimeoutMs: Long = SEND_TIMEOUT_MS,
) {
    companion object {
        const val PROTOCOL_VERSION = 1
        val RESOURCES = listOf("devices", "device", "area", "commands", "household", "alerts", "notifications", "activity")
        const val MAX_SUBSCRIPTIONS = 50
        const val MAX_CONNECTIONS_PER_USER = 10
        const val MAX_BUFFERED = 1_000_000
        const val RATE_LIMIT = 60
        const val RATE_WINDOW_MS = 10_000L
        const val RECHECK_MS = 2_000L
        const val QUEUE_LIMIT = 200
        const val FLUSH_MS = 100L
        const val SWEEP_MS = 30_000L
        /** A client that cannot take one message in this long is dropped rather than holding up everyone else. */
        const val SEND_TIMEOUT_MS = 5_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val clients = ConcurrentHashMap<String, WsClient>()
    private val messageLimiter = ConcurrentHashMap<String, MutableList<Long>>()

    val connectionCount: Int get() = clients.size

    init {
        scope.launch { bus.events.collect { event -> alice.core.concurrent.runCatchingNonCancellation { onEvent(event) } } }
        scope.launch {
            while (isActive) {
                delay(FLUSH_MS)
                flushAll()
            }
        }
        // A logged-out, revoked or expired session must not keep receiving events.
        scope.launch {
            while (isActive) {
                delay(sweepMs)
                runCatching { sweep() }
            }
        }
    }

    private val connectLock = Any()

    fun connect(socket: ClientSocket, session: SessionContext, membership: Membership): Boolean {
        val c = WsClient(socket, session.userId, session.sessionId, membership.householdId, membership.role.wire, time.now())
        // Counting and registering must be one step, or ten simultaneous connections can all see "nine open".
        val accepted = synchronized(connectLock) {
            if (clients.values.count { it.userId == session.userId } >= MAX_CONNECTIONS_PER_USER) false
            else { clients[socket.id] = c; true }
        }
        if (!accepted) {
            kotlinx.coroutines.runBlocking { runCatching { socket.close(4429, "Too many connections") } }
            return false
        }
        kotlinx.coroutines.runBlocking {
            sendNow(socket, "hello", buildJsonObject {
                put("userId", session.userId)
                put("role", membership.role.wire)
                put("resources", JsonArray(RESOURCES.map { JsonPrimitive(it) }))
                put("protocolVersion", PROTOCOL_VERSION)
            })
        }
        return true
    }

    fun disconnect(id: String) {
        clients.remove(id)
        messageLimiter.remove(id)
    }

    fun closeAll(reason: String = "Server shutting down") {
        for (c in clients.values.toList()) drop(c, 1001, reason)
    }

    fun sweep() {
        for (c in clients.values.toList()) {
            val m = households.getMembership(c.userId)
            if (auth != null && !auth.isSessionActive(c.sessionId)) { drop(c, 4401, "Session ended"); continue }
            if (m == null || m.householdId != c.householdId) { drop(c, 4401, "Session ended"); continue }
            c.role = m.role.wire
        }
    }

    /** Closes every socket (so clients learn the server went away) and stops the background loops. */
    fun stop() {
        closeAll()
        scope.cancel()
    }

    private fun drop(c: WsClient, code: Int, reason: String) {
        clients.remove(c.socket.id)
        messageLimiter.remove(c.socket.id)
        runCatching { kotlinx.coroutines.runBlocking { c.socket.close(code, reason) } }
    }

    private fun fresh(c: WsClient): Boolean {
        val now = time.now()
        if (now - c.checkedAt < RECHECK_MS) return true
        c.checkedAt = now
        val m = households.getMembership(c.userId)
        if (m == null || m.householdId != c.householdId) { drop(c, 4401, "Access ended"); return false }
        c.role = m.role.wire
        return true
    }

    private suspend fun sendNow(socket: ClientSocket, type: String, data: JsonElement? = null, requestId: String? = null) {
        val msg = buildJsonObject {
            put("type", type)
            if (data != null) put("data", data)
            if (requestId != null) put("requestId", requestId)
            put("ts", time.now())
        }
        if (socket.bufferedAmount() > MAX_BUFFERED) {
            clients[socket.id]?.let { drop(it, 1013, "Too slow") }
            return
        }
        // `send` suspends while the client's outgoing buffer is full; a client that stays stuck is dropped.
        val sent = try { withTimeoutOrNull(sendTimeoutMs) { socket.send(msg); true } } catch (e: CancellationException) { throw e } catch (_: Exception) { true } // a closed socket is cleaned up by its own read loop
        if (sent == null) clients[socket.id]?.let { drop(it, 1013, "Too slow") }
    }

    internal fun enqueue(c: WsClient, type: String, data: JsonElement?, coalesceKey: String? = null) {
        synchronized(c.queue) {
            if (coalesceKey != null) {
                val idx = c.queue.indexOfLast { it.coalesceKey == coalesceKey }
                if (idx >= 0) { c.queue[idx] = Queued(type, data, coalesceKey); return }
            }
            c.queue.add(Queued(type, data, coalesceKey))
            // Over the limit, drop the oldest message that a later one would replace (a state snapshot, which has a
            // coalesce key) before touching one that must arrive (a notification, an activity item, a command result).
            while (c.queue.size > QUEUE_LIMIT) {
                val droppable = c.queue.indexOfFirst { it.coalesceKey != null }
                c.queue.removeAt(if (droppable >= 0) droppable else 0)
            }
        }
    }

    private suspend fun flushAll() {
        // One slow client must not delay the others, so each client's batch is sent on its own.
        kotlinx.coroutines.coroutineScope {
            for (c in clients.values.toList()) {
                val batch = synchronized(c.queue) { if (c.queue.isEmpty()) null else c.queue.toList().also { c.queue.clear() } } ?: continue
                launch { for (m in batch) sendNow(c.socket, m.type, m.data) }
            }
        }
    }

    private suspend fun sendError(socket: ClientSocket, code: String, message: String, requestId: String? = null, resource: String? = null, id: String? = null) {
        sendNow(socket, "error", buildJsonObject {
            put("code", code); put("message", message)
            if (resource != null) put("resource", resource)
            if (id != null) put("id", id)
        }, requestId)
    }

    suspend fun receive(id: String, raw: Any) {
        val client = clients[id] ?: return
        val now = time.now()
        val times = messageLimiter.getOrPut(id) { mutableListOf() }
        val allowed = synchronized(times) {
            times.removeAll { it < now - RATE_WINDOW_MS }
            if (times.size >= RATE_LIMIT) false else { times.add(now); true }
        }
        if (!allowed) { sendError(client.socket, "rate_limited", "Slow down"); return }

        val msg = try { json.parseToJsonElement(raw.toString()).jsonObject } catch (_: Exception) {
            sendError(client.socket, "bad_message", "Messages must be JSON"); return
        }
        val typeEl = msg["type"] as? JsonPrimitive
        if (typeEl == null || !typeEl.isString) { sendError(client.socket, "bad_message", "Missing type"); return }
        val type = typeEl.content
        val requestId = (msg["requestId"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.take(64)

        when (type) {
            "ping" -> sendNow(client.socket, "pong", null, requestId)
            "subscribe", "unsubscribe" -> handleSubscription(client, type, msg, requestId)
            else -> sendError(client.socket, "unknown_message_type", "Unknown message type \"$type\"", requestId)
        }
    }

    private suspend fun handleSubscription(client: WsClient, type: String, msg: JsonObject, requestId: String?) {
        if (!fresh(client)) return
        val resource = (msg["resource"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (resource == null || resource !in RESOURCES) {
            sendError(client.socket, "unknown_resource", "Unknown resource \"$resource\"", requestId, resource = resource, id = (msg["id"] as? JsonPrimitive)?.content); return
        }
        val needsId = resource == "device" || resource == "area"
        val idEl = msg["id"]
        val resourceId = (idEl as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (needsId && (resourceId == null || resourceId.isBlank())) { sendError(client.socket, "validation_error", "$resource needs an id", requestId, resource, resourceId); return }
        if (!needsId && idEl != null) { sendError(client.socket, "validation_error", "$resource does not take an id", requestId, resource, resourceId); return }
        val key = if (resourceId != null) "$resource:$resourceId" else resource
        if (type == "unsubscribe") {
            client.subs.remove(key)
            sendNow(client.socket, "unsubscribed", buildJsonObject { put("resource", resource); if (resourceId != null) put("id", resourceId) }, requestId)
            return
        }
        if (client.subs.size >= MAX_SUBSCRIPTIONS && !client.subs.contains(key)) { sendError(client.socket, "too_many_subscriptions", "Too many subscriptions", requestId, resource, resourceId); return }
        if (resource == "device" && resourceId != null) {
            val visible = runCatching { things?.visible(Caller(client.householdId, client.userId, Role.fromWire(client.role), false), resourceId) }.isSuccess
            if (!visible) { sendError(client.socket, "not_found", "No such device", requestId, resource, resourceId); return }
        }
        client.subs.add(key)
        sendNow(client.socket, "subscribed", buildJsonObject { put("resource", resource); if (resourceId != null) put("id", resourceId) }, requestId)
    }

    private fun forHousehold(householdId: String): List<WsClient> = clients.values.filter { it.householdId == householdId && fresh(it) }

    private suspend fun locate(householdId: String, entityId: String): Located? {
        val ts = things ?: return null
        val list = alice.core.concurrent.runCatchingNonCancellation { ts.things(householdId, includeHidden = true) }.getOrDefault(emptyList())
        for (t in list) {
            val all = listOfNotNull(t.primary) + t.others + t.controls + t.sensors + t.facets + t.diagnostics
            val ent = all.firstOrNull { it.entityId == entityId }
            if (ent != null) return Located(t, ent)
        }
        return null
    }

    private fun canClientSeeEntity(client: WsClient, entityId: String): Boolean {
        val ts = things ?: return true
        return ts.canSee(Caller(client.householdId, client.userId, Role.fromWire(client.role), false), alice.ha.Connections.DEFAULT_ID, entityId)
    }

    private fun anyToJsonElement(v: Any?): JsonElement = when (v) {
        null -> JsonNull
        is JsonElement -> v
        is String -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        is Map<*, *> -> JsonObject(v.entries.associate { (k, vv) -> k.toString() to anyToJsonElement(vv) })
        is Iterable<*> -> JsonArray(v.map { anyToJsonElement(it) })
        else -> JsonPrimitive(v.toString())
    }
    private fun normalizedToJson(m: Map<String, Any?>): JsonObject = JsonObject(m.mapValues { (_, v) -> anyToJsonElement(v) })

    private suspend fun onEvent(event: AppEvent) {
        when (event) {
            is EntityStateChangedEvent -> onEntityState(event)
            is EntityAvailabilityChangedEvent -> onEntityAvailability(event)
            is EntityRemovedEvent -> changed(event.householdId, "inventory")
            is EntityStateChanged -> onEntityStateGeneric(event)
            is EntityAvailabilityChanged -> onEntityAvailabilityGeneric(event)
            is EntityRemoved -> changed(event.householdId, "inventory")
            is RegistryUpdatedEvent -> changed(event.householdId, "inventory")
            is InventorySynced -> changed(event.householdId, "inventory")
            is ThingsChanged -> changed(event.householdId, event.reason.ifBlank { "things" })
            is HouseholdModeChanged -> onModeChanged(event)
            is PresenceChanged -> onPresenceChanged(event)
            is InsightsChanged -> onInsightsChanged(event)
            is ActivityRecorded -> onActivityRecorded(event)
            is AlertCreated -> onAlertEvent("alert.created", event.householdId, event.alertId, event.data)
            is AlertCleared -> onAlertEvent("alert.cleared", event.householdId, event.alertId, event.data)
            is NotificationCreated -> onNotificationCreated(event)
            is ConnectionConnected -> onConnectionEvent("connection.connected", event.householdId, event.connectionId, event.status, null)
            is ConnectionDisconnected -> onConnectionEvent("connection.disconnected", event.householdId, event.connectionId, event.status, event.error)
            is CommandAppEvent -> onCommandAppEvent(event)
            else -> when (event.type) {
                "inventory.synced" -> changed(event.householdId, "inventory")
                "things.changed" -> changed(event.householdId, "things")
                "insights.changed" -> onInsightsChangedGeneric(event.householdId)
                "connection.connected", "connection.disconnected" -> onConnectionGeneric(event)
                else -> if (event.type.startsWith("command.")) onCommandGeneric(event)
            }
        }
    }

    private fun changed(householdId: String?, reason: String) {
        val hid = householdId ?: return
        for (c in forHousehold(hid)) {
            if (c.subs.any { it == "devices" || it.startsWith("device:") || it.startsWith("area:") }) {
                enqueue(c, "devices.changed", buildJsonObject { put("reason", reason) }, "devices.changed:$hid")
            }
        }
    }

    private fun onModeChanged(event: HouseholdModeChanged) {
        val hid = event.householdId ?: return
        for (c in forHousehold(hid)) if (c.subs.contains("household")) {
            enqueue(c, "household.mode_changed", buildJsonObject {
                put("mode", event.mode)
                put("previous", event.previous?.let { JsonPrimitive(it) } ?: JsonNull)
                put("changedBy", event.changedBy?.let { JsonPrimitive(it) } ?: JsonNull)
            }, "household.mode:$hid")
        }
    }

    private fun onPresenceChanged(event: PresenceChanged) {
        val hid = event.householdId ?: return
        for (c in forHousehold(hid)) {
            if (c.subs.contains("household") && can(Role.fromWire(c.role), "members.view")) {
                enqueue(c, "presence.changed", buildJsonObject {
                    put("userId", event.userId?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("personEntityId", event.personEntityId?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("home", event.home)
                }, "presence:${event.personEntityId ?: event.userId ?: "x"}")
            }
        }
    }

    private fun onInsightsChanged(event: InsightsChanged) = onInsightsChangedGeneric(event.householdId)
    private fun onInsightsChangedGeneric(householdId: String?) {
        val hid = householdId ?: return
        for (c in forHousehold(hid)) {
            if (c.subs.contains("household") && can(Role.fromWire(c.role), "mode.change")) {
                enqueue(c, "insights.changed", buildJsonObject { }, "insights:$hid")
            }
        }
    }

    private fun onConnectionEvent(type: String, householdId: String?, connectionId: String, status: String, error: String?) {
        val hid = householdId ?: return
        for (c in forHousehold(hid)) {
            if (!c.subs.contains("household") || !can(Role.fromWire(c.role), "ha.manage")) continue
            enqueue(c, type, buildJsonObject {
                put("connectionId", connectionId)
                put("status", status)
                if (error != null) put("error", error)
            }, "conn:$connectionId:$type")
        }
    }

    private fun onConnectionGeneric(event: AppEvent) {
        val hid = event.householdId ?: return
        for (c in forHousehold(hid)) {
            if (!c.subs.contains("household") || !can(Role.fromWire(c.role), "ha.manage")) continue
            enqueue(c, event.type, buildJsonObject { }, "conn:generic:${event.type}")
        }
    }

    private fun onActivityRecorded(event: ActivityRecorded) {
        val hid = event.householdId ?: return
        val data = event.data?.let { normalizedToJson(it) } ?: buildJsonObject { put("eventId", event.eventId) }
        for (c in forHousehold(hid)) {
            if (!c.subs.contains("activity")) continue
            // without activity service, deliver to members/admins (per-person view service not yet present)
            if (can(Role.fromWire(c.role), "members.view") || can(Role.fromWire(c.role), "ha.manage")) {
                enqueue(c, "activity.created", data)
            }
        }
    }

    private fun onAlertEvent(type: String, householdId: String?, alertId: String, data: Map<String, Any?>?) {
        val hid = householdId ?: return
        val payload = data?.let { normalizedToJson(it) } ?: buildJsonObject { put("alertId", alertId) }
        for (c in forHousehold(hid)) {
            if (!c.subs.contains("alerts") || !can(Role.fromWire(c.role), "notification.receive")) continue
            enqueue(c, type, payload)
        }
    }

    private fun onNotificationCreated(event: NotificationCreated) {
        val hid = event.householdId ?: return
        val payload = event.data?.let { normalizedToJson(it) } ?: buildJsonObject { put("notificationId", event.notificationId) }
        for (c in forHousehold(hid)) {
            if (c.userId == event.userId && c.subs.contains("notifications")) {
                enqueue(c, "notification.created", payload)
            }
        }
    }

    private fun wantsEntity(c: WsClient, thing: Thing): Boolean =
        c.subs.contains("devices") || c.subs.contains("device:${thing.id}") || (thing.areaId != null && c.subs.contains("area:${thing.areaId}"))

    private suspend fun onEntityState(event: EntityStateChangedEvent) {
        val hid = event.householdId ?: return
        if (forHousehold(hid).none { it.subs.isNotEmpty() }) return
        val located = locate(hid, event.entityId) ?: return
        if (located.thing.hidden) return
        val values = normalizedToJson(event.normalized)
        val proj = stateCache?.get(event.entityId)
        for (c in forHousehold(hid)) {
            if (!wantsEntity(c, located.thing)) continue
            if (!canClientSeeEntity(c, event.entityId)) continue
            val data = buildJsonObject {
                put("thingId", located.thing.id)
                put("entityId", event.entityId)
                put("role", located.entity.role.name.lowercase())
                put("availability", JsonPrimitive(proj?.availability ?: "available"))
                put("values", values)
                put("lastChanged", proj?.lastChanged ?: event.lastChanged)
            }
            enqueue(c, "entity.updated", data, "entity:${event.entityId}")
        }
    }

    private suspend fun onEntityAvailability(event: EntityAvailabilityChangedEvent) {
        val hid = event.householdId ?: return
        val located = locate(hid, event.entityId) ?: return
        if (located.thing.hidden) return
        for (c in forHousehold(hid)) {
            if (!wantsEntity(c, located.thing)) continue
            if (!canClientSeeEntity(c, event.entityId)) continue
            enqueue(c, "entity.availability_changed", buildJsonObject {
                put("thingId", located.thing.id); put("entityId", event.entityId); put("availability", event.availability)
            }, "avail:${event.entityId}")
        }
    }

    private suspend fun onEntityStateGeneric(event: EntityStateChanged) {
        val hid = event.householdId ?: return
        val located = locate(hid, event.entityId) ?: return
        if (located.thing.hidden) return
        val proj = stateCache?.get(event.entityId)
        for (c in forHousehold(hid)) {
            if (!wantsEntity(c, located.thing)) continue
            if (!canClientSeeEntity(c, event.entityId)) continue
            enqueue(c, "entity.updated", buildJsonObject {
                put("thingId", located.thing.id); put("entityId", event.entityId)
                put("role", located.entity.role.name.lowercase())
                put("availability", JsonPrimitive(proj?.availability ?: "available"))
                put("values", if (event.normalized.isNotEmpty()) normalizedToJson(event.normalized) else buildJsonObject { })
                put("lastChanged", proj?.lastChanged ?: event.lastChanged)
            }, "entity:${event.entityId}")
        }
    }

    private suspend fun onEntityAvailabilityGeneric(event: EntityAvailabilityChanged) {
        val hid = event.householdId ?: return
        val located = locate(hid, event.entityId) ?: return
        if (located.thing.hidden) return
        for (c in forHousehold(hid)) {
            if (!wantsEntity(c, located.thing)) continue
            if (!canClientSeeEntity(c, event.entityId)) continue
            enqueue(c, "entity.availability_changed", buildJsonObject {
                put("thingId", located.thing.id); put("entityId", event.entityId); put("availability", event.availability)
            }, "avail:${event.entityId}")
        }
    }

    private fun onCommandAppEvent(event: CommandAppEvent) {
        val hid = event.householdId ?: return
        val cmd = event.command
        val pub = toPublicCommand(cmd, time.now())
        val data = json.encodeToJsonElement(alice.server.commands.PublicCommand.serializer(), pub)
        for (c in forHousehold(hid)) {
            if (!c.subs.contains("commands")) continue
            if (c.role != "admin" && cmd.requestedBy != c.userId) continue
            enqueue(c, event.type, data)
        }
    }

    private fun onCommandGeneric(event: AppEvent) {
        val hid = event.householdId ?: return
        for (c in forHousehold(hid)) {
            if (!c.subs.contains("commands")) continue
            if (c.role != "admin") continue
            enqueue(c, event.type, buildJsonObject { })
        }
    }
}
