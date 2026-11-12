package alice.ha

import kotlinx.serialization.json.JsonElement

data class EntityProjection(
    val entityId: String,
    val domain: String,
    val state: String,
    val attributes: Map<String, JsonElement>,
    val normalized: Map<String, Any?>,
    val lastChanged: String,
    val lastUpdated: String,
    val availability: String,
    val lastSyncedAt: String,
)

fun domainOf(entityId: String): String = entityId.substringBefore('.')

class StateCache {
    private val map = linkedMapOf<String, EntityProjection>()

    private fun project(s: HaEntityState, at: String): EntityProjection = EntityProjection(
        entityId = s.entity_id,
        domain = domainOf(s.entity_id),
        state = s.state,
        attributes = s.attributes,
        normalized = StateNormalizer.normalize(domainOf(s.entity_id), s.state, s.attributes),
        lastChanged = s.last_changed,
        lastUpdated = s.last_updated,
        availability = availabilityOf(s.state),
        lastSyncedAt = at,
    )

    @Synchronized
    fun replaceAll(states: List<HaEntityState>, at: String = nowIso()) {
        map.clear()
        for (s in states) map[s.entity_id] = project(s, at)
    }

    @Synchronized
    fun apply(state: HaEntityState?, entityId: String, at: String = nowIso()) {
        if (state == null) map.remove(entityId) else map[entityId] = project(state, at)
    }

    @Synchronized
    fun get(entityId: String): EntityProjection? = map[entityId]

    @Synchronized
    fun list(filter: ((EntityProjection) -> Boolean)? = null): List<EntityProjection> {
        val all = map.values.toList()
        return if (filter == null) all else all.filter(filter)
    }

    val size: Int @Synchronized get() = map.size

    private fun nowIso(): String = java.time.Instant.now().toString()
}

fun availabilityOf(state: String): String = when (state) {
    "unavailable" -> "unavailable"
    "unknown" -> "unknown"
    else -> "available"
}
