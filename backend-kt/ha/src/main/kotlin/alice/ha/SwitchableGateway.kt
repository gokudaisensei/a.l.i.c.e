package alice.ha

import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject

/**
 * The gateway the rest of the app holds on to. It forwards to whichever gateway is current, so a
 * Home Assistant connection can come and go (set up, replaced, removed) without rewiring consumers.
 * Listeners registered here survive a swap: they are re-attached to the new gateway.
 */
class SwitchableGateway(initial: HomeAssistantGateway) : HomeAssistantGateway {
    @Volatile private var current: HomeAssistantGateway = initial
    private val statusCbs = java.util.concurrent.CopyOnWriteArraySet<(HaConnectionState) -> Unit>()
    private val stateCbs = java.util.concurrent.CopyOnWriteArraySet<(HaStateChangedEvent) -> Unit>()
    private val eventCbs = java.util.concurrent.CopyOnWriteArrayList<Pair<String, (HaRawEvent) -> Unit>>()
    private val lock = kotlinx.coroutines.sync.Mutex()
    private var detach: List<() -> Unit> = emptyList()

    val delegate: HomeAssistantGateway get() = current

    fun switchTo(next: HomeAssistantGateway) = kotlinx.coroutines.runBlocking { lock.withLock { doSwitch(next) } }

    private suspend fun doSwitch(next: HomeAssistantGateway) {
        detach.forEach { it() }
        current = next
        val unsubs = mutableListOf<() -> Unit>()
        unsubs += next.onStatusChange { st -> statusCbs.forEach { it(st) } }
        unsubs += next.subscribeStateChanges { ev -> stateCbs.forEach { it(ev) } }
        for (type in eventCbs.map { it.first }.toSet()) {
            unsubs += next.subscribeEvents(type) { ev -> eventCbs.filter { it.first == type }.forEach { it.second(ev) } }
        }
        detach = unsubs
        statusCbs.forEach { it(next.state) }
    }

    override val state get() = current.state
    override suspend fun connect() = current.connect()
    override suspend fun disconnect() = current.disconnect()
    override suspend fun getStates() = current.getStates()
    override suspend fun getAreas() = current.getAreas()
    override suspend fun getDevices() = current.getDevices()
    override suspend fun getEntityRegistry() = current.getEntityRegistry()
    override suspend fun getServices() = current.getServices()
    override suspend fun getConfig() = current.getConfig()
    override suspend fun callService(input: HaServiceCallInput) = current.callService(input)
    override suspend fun getHistory(ids: List<String>, from: Long, to: Long) = current.getHistory(ids, from, to)
    override suspend fun getStatistics(ids: List<String>, from: Long, to: Long, period: HaStatisticsPeriod) =
        current.getStatistics(ids, from, to, period)
    override suspend fun getLogbook(from: Long, to: Long, entityId: String?) = current.getLogbook(from, to, entityId)
    override suspend fun sendRawCommand(msg: JsonObject) = current.sendRawCommand(msg)
    override fun emitState(next: HaEntityState?, prev: HaEntityState?, entityId: String) = current.emitState(next, prev, entityId)
    override fun emitEvent(type: String, data: Map<String, Any?>) = current.emitEvent(type, data)

    override fun onStatusChange(cb: (HaConnectionState) -> Unit): () -> Unit { statusCbs.add(cb); return { statusCbs.remove(cb) } }

    override suspend fun subscribeStateChanges(cb: (HaStateChangedEvent) -> Unit): () -> Unit = lock.withLock {
        if (stateCbs.isEmpty()) detach = detach + current.subscribeStateChanges { ev -> stateCbs.forEach { it(ev) } }
        stateCbs.add(cb); { stateCbs.remove(cb) }
    }

    override suspend fun subscribeEvents(type: String, cb: (HaRawEvent) -> Unit): () -> Unit = lock.withLock {
        if (eventCbs.none { it.first == type }) {
            detach = detach + current.subscribeEvents(type) { ev -> eventCbs.filter { it.first == type }.forEach { it.second(ev) } }
        }
        val entry = type to cb
        eventCbs.add(entry); { eventCbs.remove(entry) }
    }
}
