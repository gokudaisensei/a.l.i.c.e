package alice.ha

import kotlinx.serialization.Serializable

@Serializable
data class HaContext(val id: String, val parent_id: String? = null, val user_id: String? = null)

@Serializable
data class HaEntityState(
    val entity_id: String,
    val state: String,
    val attributes: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
    val last_changed: String = "",
    val last_updated: String = "",
    val context: HaContext = HaContext("ctx"),
)

@Serializable
data class HaAreaRegistryEntry(
    val area_id: String,
    val name: String,
    val floor_id: String? = null,
    val aliases: List<String> = emptyList(),
)

@Serializable
data class HaDeviceRegistryEntry(
    val id: String,
    val name: String? = null,
    val name_by_user: String? = null,
    val area_id: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val disabled_by: String? = null,
    val via_device_id: String? = null,
    val identifiers: List<List<String>> = emptyList(),
    val connections: List<List<String>> = emptyList(),
    val entry_type: String? = null,
)

@Serializable
data class HaEntityRegistryEntry(
    val entity_id: String,
    val device_id: String? = null,
    val area_id: String? = null,
    val platform: String = "",
    val name: String? = null,
    val original_name: String? = null,
    val disabled_by: String? = null,
    val hidden_by: String? = null,
    val entity_category: String? = null,
    val has_entity_name: Boolean = false,
    val translation_key: String? = null,
)

@Serializable
data class HaServiceCallInput(
    val domain: String,
    val service: String,
    val data: Map<String, kotlinx.serialization.json.JsonElement>? = null,
    val target: HaServiceTarget? = null,
)

@Serializable
data class HaServiceTarget(
    val entity_id: List<String>? = null,
    val device_id: List<String>? = null,
    val area_id: List<String>? = null,
)

@Serializable
data class HaServiceCallResult(val contextId: String)

@Serializable
data class HaRawEvent(
    val event_type: String,
    val data: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
    val time_fired: String = "",
    val context: HaContext = HaContext("ctx"),
)

@Serializable
data class HaStateChangedEvent(
    val entity_id: String,
    val old_state: HaEntityState? = null,
    val new_state: HaEntityState? = null,
    val context: HaContext = HaContext("ctx"),
    val timeFired: String = "",
)

typealias HaStatisticsPeriod = String

class HaAuthError : Exception("Home Assistant rejected the access token")


@Serializable
data class HaLogbookEntry(
    val when_ts: String? = null,
    val name: String? = null,
    val message: String? = null,
    val entity_id: String? = null,
    val domain: String? = null,
    val state: String? = null,
    val context_user_id: String? = null,
    val context_event_type: String? = null,
    val context_domain: String? = null,
    val context_service: String? = null,
    val context_entity_id: String? = null,
    val context_entity_id_name: String? = null,
)
