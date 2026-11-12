package alice.core.events

/** Typed application events. Raw Home Assistant events never reach the bus. */

data class EntityStateChanged(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val connectionId: String = "",
    val entityId: String = "",
    val previousState: String? = null,
    val currentState: String = "",
    val attributes: Map<String, Any?> = emptyMap(),
    val normalized: Map<String, Any?> = emptyMap(),
    val lastChanged: String = "",
    val lastUpdated: String = "",
) : AppEvent { override val type = "entity.state_changed" }

data class EntityRemoved(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val entityId: String = "",
) : AppEvent { override val type = "entity.removed" }

data class EntityAvailabilityChanged(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val entityId: String = "",
    val availability: String = "",
) : AppEvent { override val type = "entity.availability_changed" }

data class ThingsChanged(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val reason: String = "",
) : AppEvent { override val type = "things.changed" }

data class HouseholdModeChanged(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val mode: String = "",
    val previous: String? = null,
    val changedBy: String? = null,
) : AppEvent { override val type = "household.mode_changed" }

data class PresenceChanged(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val userId: String? = null,
    val personEntityId: String? = null,
    val home: Boolean = false,
) : AppEvent { override val type = "presence.changed" }

data class InsightsChanged(
    override val householdId: String? = null,
    override val timestamp: String? = null,
) : AppEvent { override val type = "insights.changed" }

data class ActivityRecorded(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val eventId: String = "",
    val data: Map<String, Any?>? = null,
) : AppEvent { override val type = "activity.recorded" }

data class AlertCreated(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val alertId: String = "",
    val data: Map<String, Any?>? = null,
) : AppEvent { override val type = "alert.created" }

data class AlertCleared(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val alertId: String = "",
    val data: Map<String, Any?>? = null,
) : AppEvent { override val type = "alert.cleared" }

data class NotificationCreated(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val userId: String = "",
    val notificationId: String = "",
    val data: Map<String, Any?>? = null,
) : AppEvent { override val type = "notification.created" }

data class ConnectionConnected(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val connectionId: String = "",
    val status: String = "",
) : AppEvent { override val type = "connection.connected" }

data class ConnectionDisconnected(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val connectionId: String = "",
    val status: String = "",
    val error: String? = null,
) : AppEvent { override val type = "connection.disconnected" }

data class InventorySynced(
    override val householdId: String? = null,
    override val timestamp: String? = null,
    val connectionId: String = "",
) : AppEvent { override val type = "inventory.synced" }
