package alice.ha

import alice.core.events.AppEvent
import kotlinx.serialization.json.JsonElement

data class EventScope(val householdId: String, val connectionId: String)

sealed interface HaAppEvent : AppEvent

data class EntityStateChangedEvent(
    override val type: String = "entity.state_changed",
    override val householdId: String?,
    val connectionId: String,
    override val timestamp: String,
    val entityId: String,
    val previousState: String?,
    val currentState: String,
    val attributes: Map<String, JsonElement>,
    val normalized: NormalizedState,
    val lastChanged: String,
    val lastUpdated: String,
    val contextId: String,
    val contextParentId: String?,
    val contextUserId: String?,
) : HaAppEvent

data class EntityAttributesChangedEvent(
    override val type: String = "entity.attributes_changed",
    override val householdId: String?,
    val connectionId: String,
    override val timestamp: String,
    val entityId: String,
    val attributes: Map<String, JsonElement>,
    val normalized: NormalizedState,
    val lastUpdated: String,
    val contextId: String,
    val contextParentId: String?,
    val contextUserId: String?,
) : HaAppEvent

data class EntityRemovedEvent(
    override val type: String = "entity.removed",
    override val householdId: String?,
    val connectionId: String,
    override val timestamp: String,
    val entityId: String,
) : HaAppEvent

data class EntityAvailabilityChangedEvent(
    override val type: String = "entity.availability_changed",
    override val householdId: String?,
    val connectionId: String,
    override val timestamp: String,
    val entityId: String,
    val availability: String,
) : HaAppEvent

data class RegistryUpdatedEvent(
    override val type: String = "registry.updated",
    override val householdId: String?,
    val connectionId: String,
    override val timestamp: String,
    val registry: String,
) : HaAppEvent

object Normalizer {
    fun normalizeStateChanged(scope: EventScope, ev: HaStateChangedEvent): List<HaAppEvent> {
        val base = scope
        if (ev.new_state == null) {
            return listOf(EntityRemovedEvent(householdId = base.householdId, connectionId = base.connectionId, timestamp = ev.timeFired, entityId = ev.entity_id))
        }
        val next = ev.new_state
        val out = mutableListOf<HaAppEvent>()
        val stateChanged = ev.old_state == null || ev.old_state.state != next.state
        if (stateChanged) {
            out.add(
                EntityStateChangedEvent(
                    householdId = base.householdId,
                    connectionId = base.connectionId,
                    timestamp = ev.timeFired,
                    entityId = ev.entity_id,
                    previousState = ev.old_state?.state,
                    currentState = next.state,
                    attributes = next.attributes,
                    normalized = StateNormalizer.normalize(ev.entity_id.substringBefore('.'), next.state, next.attributes),
                    lastChanged = next.last_changed,
                    lastUpdated = next.last_updated,
                    contextId = ev.context.id,
                    contextParentId = ev.context.parent_id,
                    contextUserId = ev.context.user_id,
                ),
            )
        } else {
            out.add(
                EntityAttributesChangedEvent(
                    householdId = base.householdId,
                    connectionId = base.connectionId,
                    timestamp = ev.timeFired,
                    entityId = ev.entity_id,
                    attributes = next.attributes,
                    normalized = StateNormalizer.normalize(ev.entity_id.substringBefore('.'), next.state, next.attributes),
                    lastUpdated = next.last_updated,
                    contextId = ev.context.id,
                    contextParentId = ev.context.parent_id,
                    contextUserId = ev.context.user_id,
                ),
            )
        }
        val before = ev.old_state?.let { availabilityOf(it.state) }
        val after = availabilityOf(next.state)
        if (before != null && before != after) {
            out.add(EntityAvailabilityChangedEvent(householdId = base.householdId, connectionId = base.connectionId, timestamp = ev.timeFired, entityId = ev.entity_id, availability = after))
        }
        return out
    }

    private val registryEvents = mapOf(
        "area_registry_updated" to "area",
        "device_registry_updated" to "device",
        "entity_registry_updated" to "entity",
    )

    fun normalizeRegistryEvent(scope: EventScope, ev: HaRawEvent): HaAppEvent? {
        val registry = registryEvents[ev.event_type] ?: return null
        return RegistryUpdatedEvent(householdId = scope.householdId, connectionId = scope.connectionId, timestamp = ev.time_fired, registry = registry)
    }

    fun normalizeAliceNotification(scope: EventScope, ev: HaRawEvent): HaAppEvent? {
        if (ev.event_type != "alice_notification") return null
        val message = (ev.data["message"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.take(500) ?: return null
        if (message.isBlank()) return null
        val title = (ev.data["title"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.take(100)?.ifBlank { "Home" } ?: "Home"
        return null // placeholder: HaNotificationEvent not modeled; skip to keep scope
    }

    fun normalizeAutomationTriggered(scope: EventScope, ev: HaRawEvent): HaAppEvent? {
        if (ev.event_type != "automation_triggered") return null
        val entityId = (ev.data["entity_id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return null
        return null
    }
}
