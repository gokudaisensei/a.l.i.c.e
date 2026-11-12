package alice.ha

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class FakeGateway : HomeAssistantGateway {
    var _status: HaConnectionState = HaConnectionState.DISCONNECTED
    val states = mutableListOf<HaEntityState>()
    val areas = mutableListOf<HaAreaRegistryEntry>()
    val devices = mutableListOf<HaDeviceRegistryEntry>()
    val entityRegistry = mutableListOf<HaEntityRegistryEntry>()
    val calls = mutableListOf<HaServiceCallInput>()
    val history = mutableMapOf<String, MutableList<Any>>()
    val statistics = mutableMapOf<String, MutableMap<String, MutableList<Any>>>()
    val historyCalls = mutableListOf<Triple<List<String>, Long, Long>>()
    val statisticsCalls = mutableListOf<Quad<List<String>, Long, Long, String>>()
    val connectFailures = mutableListOf<Throwable>()
    var connectAttempts = 0
    var connectDelayMs: Long = 0
    var onCallService: (suspend (HaServiceCallInput) -> Unit)? = null

    private val statusCbs = mutableSetOf<(HaConnectionState) -> Unit>()
    private val stateCbs = mutableSetOf<(HaStateChangedEvent) -> Unit>()
    private val eventCbs = mutableMapOf<String, MutableSet<(HaRawEvent) -> Unit>>()

    override val state: HaConnectionState get() = _status

    override suspend fun connect() {
        connectAttempts++
        if (connectDelayMs > 0) kotlinx.coroutines.delay(connectDelayMs)
        val fail = connectFailures.removeFirstOrNull()
        if (fail != null) { setStatus(HaConnectionState.DISCONNECTED); throw fail }
        setStatus(HaConnectionState.CONNECTED)
    }

    override suspend fun disconnect() = setStatus(HaConnectionState.DISCONNECTED)

    override suspend fun getStates() = states.toList()
    override suspend fun getAreas() = areas.toList()
    override suspend fun getDevices() = devices.toList()
    override suspend fun getEntityRegistry() = entityRegistry.toList()
    override suspend fun getServices() = emptyMap<String, Map<String, Any?>>()
    override suspend fun getConfig() = mapOf("version" to "2026.10.4", "location_name" to "Fake Home")
    override suspend fun callService(input: HaServiceCallInput): HaServiceCallResult {
        calls.add(input)
        onCallService?.invoke(input)
        return HaServiceCallResult("ctx-${calls.size}")
    }
    override suspend fun getHistory(ids: List<String>, from: Long, to: Long): Map<String, List<Any>> {
        historyCalls.add(Triple(ids, from, to))
        return ids.associateWith { id -> (history[id] ?: emptyList()).filter { true } }
    }
    override suspend fun getStatistics(ids: List<String>, from: Long, to: Long, period: HaStatisticsPeriod): Map<String, List<Any>> {
        statisticsCalls.add(Quad(ids, from, to, period))
        return ids.associateWith { id -> (statistics[id]?.get(period) ?: emptyList()) }
    }
    val logbookEntries = mutableListOf<HaLogbookEntry>()
    override suspend fun getLogbook(from: Long, to: Long, entityId: String?): List<HaLogbookEntry> = logbookEntries.toList()

    override fun onStatusChange(cb: (HaConnectionState) -> Unit): () -> Unit {
        statusCbs.add(cb); return { statusCbs.remove(cb) }
    }
    override suspend fun subscribeStateChanges(cb: (HaStateChangedEvent) -> Unit): () -> Unit {
        stateCbs.add(cb); return { stateCbs.remove(cb) }
    }
    override suspend fun subscribeEvents(type: String, cb: (HaRawEvent) -> Unit): () -> Unit {
        val set = eventCbs.getOrPut(type) { mutableSetOf() }; set.add(cb); return { set.remove(cb) }
    }

    override fun emitState(next: HaEntityState?, prev: HaEntityState?, entityId: String) {
        val id = entityId
        stateCbs.forEach { it(HaStateChangedEvent(id, prev, next, timeFired = "2026-01-01T00:00:01Z")) }
    }
    override suspend fun sendRawCommand(msg: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject =
        kotlinx.serialization.json.buildJsonObject { put("success", kotlinx.serialization.json.JsonPrimitive(true)) }

    override fun emitEvent(type: String, data: Map<String, Any?>) {
        eventCbs[type]?.forEach { it(HaRawEvent(type, data.mapValues { (_, v) -> if (v is List<*>) kotlinx.serialization.json.JsonArray(v.map { kotlinx.serialization.json.JsonPrimitive(it?.toString()) }) else kotlinx.serialization.json.JsonPrimitive(v?.toString()) }, time_fired = "2026-01-01T00:00:01Z")) }
    }

    fun setStatus(s: HaConnectionState) { _status = s; statusCbs.forEach { it(s) } }

    // helpers
    class Triple<A, B, C>(val a: A, val b: B, val c: C)
    class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)
}
