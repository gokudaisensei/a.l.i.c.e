package alice.ha

import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.url
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.readText
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicInteger

class HaWebSocketGateway(
    private val baseUrl: String,
    private val token: String,
    private val client: HttpClient,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : HomeAssistantGateway {

    companion object {
        /** Home Assistant events that mean the set of devices, entities or areas changed. */
        val REGISTRY_EVENTS = listOf("area_registry_updated", "device_registry_updated", "entity_registry_updated")

        private val sharedClient by lazy {
            io.ktor.client.HttpClient(io.ktor.client.engine.cio.CIO) { install(io.ktor.client.plugins.websocket.WebSockets) }
        }

        /** A gateway on the shared client; the websocket URL is derived from [baseUrl]. */
        fun create(baseUrl: String, token: String) = HaWebSocketGateway(baseUrl.trimEnd('/'), token, sharedClient)
    }

    private val idCounter = AtomicInteger(1)
    private var session: WebSocketSession? = null
    // Touched from the receive loop and from callers on other threads.
    private val pending = java.util.concurrent.ConcurrentHashMap<Int, Channel<JsonObject>>()
    private val stateCbs = java.util.concurrent.CopyOnWriteArraySet<(HaStateChangedEvent) -> Unit>()
    private val eventCbs = java.util.concurrent.ConcurrentHashMap<String, MutableSet<(HaRawEvent) -> Unit>>()
    private val statusCbs = java.util.concurrent.CopyOnWriteArraySet<(HaConnectionState) -> Unit>()

    @Volatile private var _status: HaConnectionState = HaConnectionState.DISCONNECTED
    override val state: HaConnectionState get() = _status

    override suspend fun connect() {
        setStatus(HaConnectionState.CONNECTING)
        val wsUrl = baseUrl.replaceFirst("http", "ws") + "/api/websocket"
        val s = client.webSocketSession { url(wsUrl) }
        session = s
        // auth flow
        val authRequired = receiveMessage(s)
        if (authRequired["type"]?.jsonPrimitive?.content != "auth_required") throw IllegalStateException("expected auth_required")
        s.send(Frame.Text(buildJsonObject { put("type", "auth"); put("access_token", token) }.toString()))
        val authResult = receiveMessage(s)
        when (authResult["type"]?.jsonPrimitive?.content) {
            "auth_ok" -> Unit
            "auth_invalid" -> { s.cancel(); setStatus(HaConnectionState.ERROR); throw HaAuthError() }
            else -> { s.cancel(); setStatus(HaConnectionState.ERROR); throw IllegalStateException("unexpected auth reply: $authResult") }
        }
        setStatus(HaConnectionState.CONNECTED)
        startReceiveLoop(s)
        // Subscribe to relevant HA events so state/person/automation changes flow into Alice.
        runCatching { sendCommand("subscribe_events", buildJsonObject { put("event_type", "state_changed") }) }
        runCatching { sendCommand("subscribe_events", buildJsonObject { put("event_type", "automation_triggered") }) }
        runCatching { sendCommand("subscribe_events", buildJsonObject { put("event_type", "call_service") }) }
        runCatching { sendCommand("subscribe_events", buildJsonObject { put("event_type", "alice_notification") }) }
        for (registry in REGISTRY_EVENTS) runCatching { sendCommand("subscribe_events", buildJsonObject { put("event_type", registry) }) }
    }

    override suspend fun disconnect() {
        session?.cancel()
        session = null
        setStatus(HaConnectionState.DISCONNECTED)
    }

    private fun setStatus(s: HaConnectionState) { _status = s; statusCbs.forEach { it(s) } }

    private suspend fun receiveMessage(s: WebSocketSession): JsonObject {
        val frame = s.incoming.receive()
        return json.parseToJsonElement((frame as Frame.Text).readText()).jsonObject
    }

    private fun startReceiveLoop(s: WebSocketSession) {
        // Launch a coroutine to pump incoming frames
        s.launch {
            try { pump(s) } finally {
                // The socket is gone: fail waiting callers and tell listeners, unless a newer session replaced this one.
                pending.values.forEach { it.close() }
                pending.clear()
                if (session === s) { session = null; setStatus(HaConnectionState.DISCONNECTED) }
            }
        }
    }

    private suspend fun pump(s: WebSocketSession) {
        run {
            for (frame in s.incoming) {
                if (frame !is Frame.Text) continue
                val msg = runCatching { json.parseToJsonElement(frame.readText()).jsonObject }.getOrNull() ?: continue
                val id = msg["id"]?.jsonPrimitive?.content?.toIntOrNull()
                if (id != null && pending.containsKey(id)) {
                    pending[id]?.trySend(msg)
                    continue
                }
                val type = msg["type"]?.jsonPrimitive?.content
                if (type == "event") {
                    val event = msg["event"]?.jsonObject
                    val eventType = event?.get("event_type")?.jsonPrimitive?.content
                    val dataObj = event?.get("data")?.jsonObject
                    if (eventType == "state_changed") {
                        val entityId = dataObj?.get("entity_id")?.jsonPrimitive?.content ?: ""
                        val newState = dataObj?.get("new_state")?.let { runCatching { json.decodeFromJsonElement(HaEntityState.serializer(), it) }.getOrNull() }
                        val oldState = dataObj?.get("old_state")?.let { runCatching { json.decodeFromJsonElement(HaEntityState.serializer(), it) }.getOrNull() }
                        val ev = HaStateChangedEvent(entityId, oldState, newState, timeFired = event.get("time_fired")?.jsonPrimitive?.content ?: "")
                        stateCbs.toList().forEach { runCatching { it(ev) } }
                    }
                    if (eventType != null) {
                        val dataMap = dataObj?.mapValues { (_, v) -> v } ?: emptyMap<String, JsonElement>()
                        val raw = HaRawEvent(eventType, data = dataMap, time_fired = event.get("time_fired")?.jsonPrimitive?.content ?: "")
                        eventCbs[eventType]?.toList()?.forEach { runCatching { it(raw) } }
                        eventCbs["*"]?.toList()?.forEach { runCatching { it(raw) } }
                    }
                }
            }
        }
    }

    private suspend fun sendCommand(type: String, extra: JsonObject = JsonObject(emptyMap())): JsonObject =
        sendCommand(buildJsonObject { put("type", type); for ((k, v) in extra) put(k, v) })

    private suspend fun sendCommand(msg: JsonObject): JsonObject {
        val s = session ?: throw IllegalStateException("not connected")
        val id = idCounter.getAndIncrement()
        val ch = Channel<JsonObject>(1)
        pending[id] = ch
        try {
            s.send(Frame.Text(buildJsonObject { put("id", id); for ((k, v) in msg) put(k, v) }.toString()))
            return withTimeout(30_000) { ch.receive() }
        } finally {
            pending.remove(id)
        }
    }

    override suspend fun getStates(): List<HaEntityState> {
        val r = sendCommand("get_states")
        val result = r["result"] ?: return emptyList()
        return json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(HaEntityState.serializer()), result)
    }

    override suspend fun getAreas(): List<HaAreaRegistryEntry> {
        val r = sendCommand("config/area_registry/list")
        val result = r["result"] ?: return emptyList()
        return json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(HaAreaRegistryEntry.serializer()), result)
    }

    override suspend fun getDevices(): List<HaDeviceRegistryEntry> {
        val r = sendCommand("config/device_registry/list")
        val result = r["result"] ?: return emptyList()
        return json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(HaDeviceRegistryEntry.serializer()), result)
    }

    override suspend fun getEntityRegistry(): List<HaEntityRegistryEntry> {
        val r = sendCommand("config/entity_registry/list")
        val result = r["result"] ?: return emptyList()
        return json.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(HaEntityRegistryEntry.serializer()), result)
    }

    override suspend fun getServices(): Map<String, Map<String, Any?>> = emptyMap()
    override suspend fun getConfig(): Map<String, Any?> {
        val result = sendCommand("get_config")["result"] as? JsonObject ?: return emptyMap()
        return result.mapValues { (_, v) -> (v as? JsonPrimitive)?.let { if (it.isString) it.content else it.toString() } ?: v.toString() }
    }

    override suspend fun callService(input: HaServiceCallInput): HaServiceCallResult {
        val extra = buildJsonObject {
            put("domain", input.domain)
            put("service", input.service)
            input.data?.let { d ->
                val obj = buildJsonObject { for ((k, v) in d) put(k, v) }
                put("service_data", obj)
            }
            input.target?.let { t ->
                val target = buildJsonObject {
                    t.entity_id?.let { put("entity_id", kotlinx.serialization.json.JsonArray(it.map { kotlinx.serialization.json.JsonPrimitive(it) })) }
                    t.device_id?.let { put("device_id", kotlinx.serialization.json.JsonArray(it.map { kotlinx.serialization.json.JsonPrimitive(it) })) }
                    t.area_id?.let { put("area_id", kotlinx.serialization.json.JsonArray(it.map { kotlinx.serialization.json.JsonPrimitive(it) })) }
                }
                put("target", target)
            }
        }
        val r = sendCommand("call_service", extra)
        val ctx = r["context"]?.jsonObject?.get("id")?.jsonPrimitive?.content ?: "ctx"
        return HaServiceCallResult(ctx)
    }

    override suspend fun getHistory(ids: List<String>, from: Long, to: Long): Map<String, List<Any>> {
        val extra = buildJsonObject {
            put("type", "history/history_during_period")
            put("start_time", java.time.Instant.ofEpochMilli(from).toString())
            put("end_time", java.time.Instant.ofEpochMilli(to).toString())
            put("entity_ids", JsonArray(ids.map { JsonPrimitive(it) }))
            put("include_start_time_state", true)
            put("significant_changes_only", false)
            put("minimal_response", false)
            put("no_attributes", false)
        }
        val r = sendCommand(extra)
        val result = r["result"]?.jsonObject ?: return emptyMap()
        val out = mutableMapOf<String, MutableList<Any>>()
        for ((id, rows) in result) {
            val arr = rows as? JsonArray ?: continue
            val list = mutableListOf<Any>()
            var lastAttrs: Map<String, JsonElement> = emptyMap()
            for (row in arr) {
                val obj = row as? JsonObject ?: continue
                val state = obj["s"]?.jsonPrimitive?.content ?: ""
                val attrs = obj["a"]?.jsonObject
                if (attrs != null) lastAttrs = attrs
                val lu = obj["lu"]?.jsonPrimitive?.content?.toDoubleOrNull()
                val lc = obj["lc"]?.jsonPrimitive?.content?.toDoubleOrNull()
                val at = ((lu ?: lc ?: (from / 1000.0)) * 1000).toLong()
                list.add(mapOf("at" to at, "state" to state, "attributes" to lastAttrs))
            }
            out[id] = list
        }
        return out
    }

    override suspend fun sendRawCommand(msg: JsonObject): JsonObject = sendCommand(msg)

    override suspend fun getStatistics(ids: List<String>, from: Long, to: Long, period: HaStatisticsPeriod): Map<String, List<Any>> {
        val extra = buildJsonObject {
            put("type", "recorder/statistics_during_period")
            put("start_time", java.time.Instant.ofEpochMilli(from).toString())
            put("end_time", java.time.Instant.ofEpochMilli(to).toString())
            put("statistic_ids", JsonArray(ids.map { JsonPrimitive(it) }))
            put("period", period)
            put("types", JsonArray(listOf("change", "mean", "min", "max", "sum").map { JsonPrimitive(it) }))
        }
        val r = sendCommand(extra)
        val result = r["result"]?.jsonObject ?: return emptyMap()
        val out = mutableMapOf<String, List<Any>>()
        for ((id, rows) in result) {
            val arr = rows as? JsonArray ?: continue
            out[id] = arr.toList()
        }
        return out
    }

    override suspend fun getLogbook(from: Long, to: Long, entityId: String?): List<HaLogbookEntry> {
        return try {
            val extra = buildJsonObject {
                put("type", "logbook/get_events")
                put("start_time", java.time.Instant.ofEpochMilli(from).toString())
                put("end_time", java.time.Instant.ofEpochMilli(to).toString())
                entityId?.let { put("entity_id", it) }
            }
            val r = sendCommand(extra)
            val result = r["result"] as? JsonArray ?: return emptyList()
            result.mapNotNull { el ->
                val o = el as? JsonObject ?: return@mapNotNull null
                HaLogbookEntry(
                    when_ts = o["when"]?.jsonPrimitive?.content ?: o["when"]?.toString()?.trim('"'),
                    name = o["name"]?.jsonPrimitive?.content,
                    message = o["message"]?.jsonPrimitive?.content,
                    entity_id = o["entity_id"]?.jsonPrimitive?.content,
                    domain = o["domain"]?.jsonPrimitive?.content,
                    state = o["state"]?.jsonPrimitive?.content,
                    context_user_id = o["context_user_id"]?.jsonPrimitive?.content,
                    context_event_type = o["context_event_type"]?.jsonPrimitive?.content,
                    context_domain = o["context_domain"]?.jsonPrimitive?.content,
                    context_service = o["context_service"]?.jsonPrimitive?.content,
                    context_entity_id = o["context_entity_id"]?.jsonPrimitive?.content,
                    context_entity_id_name = o["context_entity_id_name"]?.jsonPrimitive?.content,
                )
            }
        } catch (_: Throwable) { emptyList() }
    }

    override fun onStatusChange(cb: (HaConnectionState) -> Unit): () -> Unit {
        statusCbs.add(cb); return { statusCbs.remove(cb) }
    }
    override suspend fun subscribeStateChanges(cb: (HaStateChangedEvent) -> Unit): () -> Unit {
        stateCbs.add(cb); return { stateCbs.remove(cb) }
    }
    override suspend fun subscribeEvents(type: String, cb: (HaRawEvent) -> Unit): () -> Unit {
        val set = eventCbs.getOrPut(type) { java.util.concurrent.CopyOnWriteArraySet() }; set.add(cb); return { set.remove(cb) }
    }

    override fun emitState(next: HaEntityState?, prev: HaEntityState?, entityId: String) {
        stateCbs.forEach { it(HaStateChangedEvent(entityId, prev, next)) }
    }
    override fun emitEvent(type: String, data: Map<String, Any?>) {
        val raw = HaRawEvent(type, data = data.mapValues { (_, v) -> kotlinx.serialization.json.JsonPrimitive(v?.toString() ?: "null") }, time_fired = "")
        eventCbs[type]?.toList()?.forEach { runCatching { it(raw) } }
        eventCbs["*"]?.toList()?.forEach { runCatching { it(raw) } }
    }
}
