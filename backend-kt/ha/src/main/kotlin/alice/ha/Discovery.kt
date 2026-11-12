package alice.ha

class Discovery(private val gateway: HomeAssistantGateway) {
    suspend fun inventory(): Inventory = buildInventory(
        RawDiscovery(
            areas = gateway.getAreas(),
            devices = gateway.getDevices(),
            entityRegistry = gateway.getEntityRegistry(),
            states = gateway.getStates(),
        ),
    )
}
