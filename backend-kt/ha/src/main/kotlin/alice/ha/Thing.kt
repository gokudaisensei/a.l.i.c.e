package alice.ha

import kotlinx.serialization.Serializable

@Serializable
enum class EntityRole { primary, control, facet, sensor, diagnostic, config }

@Serializable
enum class ThingKind { device, service, virtual }

@Serializable
data class ThingEntity(
    val entityId: String,
    val domain: String,
    val name: String,
    val role: EntityRole,
    val deviceClass: String?,
    val roleReason: String,
    val capabilities: List<DeviceCapability>,
    val key: String? = null,
    val attachedTo: String? = null,
)

@Serializable
data class Thing(
    val id: String,
    val ref: String,
    val kind: ThingKind,
    val name: String,
    val nameSource: String,
    val sourceName: String,
    val areaId: String?,
    val hidden: Boolean,
    val primary: ThingEntity?,
    val others: List<ThingEntity>,
    val controls: List<ThingEntity>,
    val facets: List<ThingEntity>,
    val sensors: List<ThingEntity>,
    val diagnostics: List<ThingEntity>,
    val entityIds: List<String>,
    val hubThingId: String?,
    val deviceIds: List<String>,
    val aliases: List<String>,
    val manufacturer: String?,
    val model: String?,
)
