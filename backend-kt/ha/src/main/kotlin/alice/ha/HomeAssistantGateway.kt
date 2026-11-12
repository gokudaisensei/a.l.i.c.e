package alice.ha

enum class HaConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    ERROR,
}

interface HomeAssistantGateway {
    val state: HaConnectionState

    suspend fun connect()
    suspend fun disconnect()

    suspend fun getStates(): List<HaEntityState>
    suspend fun getAreas(): List<HaAreaRegistryEntry>
    suspend fun getDevices(): List<HaDeviceRegistryEntry>
    suspend fun getEntityRegistry(): List<HaEntityRegistryEntry>
    suspend fun getServices(): Map<String, Map<String, Any?>>
    suspend fun getConfig(): Map<String, Any?>
    suspend fun callService(input: HaServiceCallInput): HaServiceCallResult

    suspend fun getHistory(ids: List<String>, from: Long, to: Long): Map<String, List<Any>>
    suspend fun getStatistics(ids: List<String>, from: Long, to: Long, period: HaStatisticsPeriod): Map<String, List<Any>>
    suspend fun getLogbook(from: Long, to: Long, entityId: String? = null): List<HaLogbookEntry> = emptyList()

    fun onStatusChange(cb: (HaConnectionState) -> Unit): () -> Unit
    suspend fun subscribeStateChanges(cb: (HaStateChangedEvent) -> Unit): () -> Unit
    suspend fun subscribeEvents(type: String, cb: (HaRawEvent) -> Unit): () -> Unit
    /** Send a raw websocket command and return the raw response (for admin/config operations). */
    suspend fun sendRawCommand(msg: kotlinx.serialization.json.JsonObject): kotlinx.serialization.json.JsonObject

    fun emitState(next: HaEntityState?, prev: HaEntityState? = null, entityId: String = next?.entity_id ?: prev!!.entity_id)
    fun emitEvent(type: String, data: Map<String, Any?> = emptyMap())
}
