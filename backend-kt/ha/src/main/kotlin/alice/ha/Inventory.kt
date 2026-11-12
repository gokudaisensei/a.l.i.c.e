package alice.ha

import kotlinx.serialization.json.JsonElement

data class InventoryArea(val areaId: String, val name: String)
data class InventoryDevice(
    val deviceId: String,
    val name: String,
    val areaId: String?,
    val manufacturer: String?,
    val model: String?,
    val viaDeviceId: String?,
    val identifiers: List<List<String>>,
    val connections: List<List<String>>,
    val entryType: String?,
)
data class InventoryEntity(
    val entityId: String,
    val domain: String,
    val name: String,
    val deviceId: String?,
    val areaId: String?,
    val platform: String?,
    val sourceName: String,
    val ownName: String?,
    val hasEntityName: Boolean,
    val entityCategory: String?,
    val deviceClass: String?,
    val translationKey: String?,
    val capabilities: List<DeviceCapability>,
)
data class Inventory(
    val areas: List<InventoryArea>,
    val devices: List<InventoryDevice>,
    val entities: List<InventoryEntity>,
    val syncedAt: String,
)

data class RawDiscovery(
    val areas: List<HaAreaRegistryEntry>,
    val devices: List<HaDeviceRegistryEntry>,
    val entityRegistry: List<HaEntityRegistryEntry>,
    val states: List<HaEntityState>,
)

fun buildInventory(raw: RawDiscovery, at: String = java.time.Instant.now().toString()): Inventory {
    val devices = raw.devices.filter { it.disabled_by == null }
    val deviceById = devices.associateBy { it.id }
    val regById = raw.entityRegistry.associateBy { it.entity_id }
    val entities = mutableListOf<InventoryEntity>()
    for (s in raw.states) {
        val reg = regById[s.entity_id]
        if (reg?.disabled_by != null || reg?.hidden_by != null) continue
        val device = reg?.device_id?.let { deviceById[it] }
        val domain = domainOf(s.entity_id)
        val friendly = (s.attributes["friendly_name"] as? kotlinx.serialization.json.JsonPrimitive)?.content
        val ownName = reg?.name ?: reg?.original_name
        entities.add(
            InventoryEntity(
                entityId = s.entity_id,
                domain = domain,
                name = friendly ?: ownName ?: s.entity_id,
                sourceName = friendly ?: ownName ?: s.entity_id,
                ownName = ownName,
                hasEntityName = reg?.has_entity_name ?: false,
                entityCategory = reg?.entity_category,
                deviceClass = (s.attributes["device_class"] as? kotlinx.serialization.json.JsonPrimitive)?.content,
                translationKey = reg?.translation_key,
                deviceId = reg?.device_id,
                areaId = reg?.area_id ?: device?.area_id,
                platform = reg?.platform,
                capabilities = CapabilityDetector.detect(CapabilitySource(s.entity_id, domain, s.attributes)),
            ),
        )
    }
    return Inventory(
        areas = raw.areas.map { InventoryArea(it.area_id, it.name) },
        devices = devices.map { d ->
            InventoryDevice(
                deviceId = d.id,
                name = d.name_by_user ?: d.name ?: d.id,
                areaId = d.area_id,
                manufacturer = d.manufacturer,
                model = d.model,
                viaDeviceId = d.via_device_id,
                identifiers = d.identifiers,
                connections = d.connections,
                entryType = d.entry_type,
            )
        },
        entities = entities,
        syncedAt = at,
    )
}
