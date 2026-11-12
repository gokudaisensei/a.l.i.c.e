package alice.ha

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

data class FacetValue(
    val key: String,
    val entityId: String,
    val value: String,
    val label: String,
    val active: Boolean?,
    val tone: String,
    val ambiguous: Boolean,
    val basis: String,
    val sensitive: Boolean,
    val suggestion: String? = null,
)

object FacetValues {
    private val SENSITIVE = setOf("privacy_shutter", "mic_muted", "tamper")

    fun describeFacet(
        key: String,
        entityId: String,
        domain: String,
        deviceClass: String?,
        name: String,
        state: String?,
        onMeans: String? = null,
    ): FacetValue {
        val sensitive = key in SENSITIVE
        if (state == null || state == "unavailable" || state == "unknown") {
            return FacetValue(key, entityId, "unknown", "Unavailable", null, "neutral", false, "none", sensitive)
        }
        val isOn = state == "on"
        // Enum-style: non-binary sensors/switches report value directly
        if (domain != "binary_sensor" && domain != "switch") {
            val v = state.lowercase()
            return FacetValue(key, entityId, v, v.replaceFirstChar { it.uppercase() }, null, toneFor(v), false, "state", sensitive)
        }
        // Resolve polarity
        val polarity = resolvePolarity(deviceClass, name, onMeans)
        val (on, off, onTone, offTone, basis, ambiguous) = polarity
        val value = if (isOn) on else off
        val suggestion = if (ambiguous) suggestPolarity(deviceClass) else null
        return FacetValue(key, entityId, value, value.replaceFirstChar { it.uppercase() }, isOn, if (isOn) onTone else offTone, ambiguous, basis, sensitive, suggestion)
    }

    private data class Polarity(val on: String, val off: String, val onTone: String, val offTone: String, val basis: String, val ambiguous: Boolean)

    private val BY_DEVICE_CLASS = mapOf(
        "door" to Polarity("open", "closed", "warn", "ok", "device_class", false),
        "window" to Polarity("open", "closed", "warn", "ok", "device_class", false),
        "opening" to Polarity("open", "closed", "warn", "ok", "device_class", false),
        "garage_door" to Polarity("open", "closed", "warn", "ok", "device_class", false),
        "motion" to Polarity("detected", "clear", "neutral", "neutral", "device_class", false),
        "occupancy" to Polarity("occupied", "vacant", "neutral", "neutral", "device_class", false),
        "presence" to Polarity("home", "away", "neutral", "neutral", "device_class", false),
        "tamper" to Polarity("tampered", "ok", "alert", "ok", "device_class", false),
        "moisture" to Polarity("wet", "dry", "alert", "ok", "device_class", false),
        "running" to Polarity("running", "idle", "neutral", "neutral", "device_class", false),
        "privacy" to Polarity("private", "normal", "neutral", "neutral", "device_class", false),
    )

    private fun resolvePolarity(deviceClass: String?, name: String, onMeans: String?): Polarity {
        if (onMeans != null) {
            val off = OPPOSITE[onMeans] ?: "not $onMeans"
            return Polarity(onMeans, off, toneFor(onMeans), toneFor(off), "override", false)
        }
        if (deviceClass != null && BY_DEVICE_CLASS.containsKey(deviceClass)) {
            return BY_DEVICE_CLASS[deviceClass]!!
        }
        // name-based
        val lower = name.lowercase()
        if (Regex("shutter|cover|lid").containsMatchIn(lower)) {
            if (Regex("closed|covered").containsMatchIn(lower)) return Polarity("closed", "open", "ok", "ok", "name", false)
            if (Regex("open").containsMatchIn(lower)) return Polarity("open", "closed", "ok", "ok", "name", false)
        }
        if (Regex("muted?").containsMatchIn(lower)) return Polarity("muted", "unmuted", "warn", "ok", "name", false)
        if (Regex("privacy").containsMatchIn(lower)) return Polarity("private", "normal", "neutral", "neutral", "name", false)
        if (Regex("tamper").containsMatchIn(lower)) return Polarity("tampered", "ok", "alert", "ok", "name", false)
        if (Regex("open").containsMatchIn(lower)) return Polarity("open", "closed", "warn", "ok", "name", false)
        if (Regex("motion|movement").containsMatchIn(lower)) return Polarity("detected", "clear", "neutral", "neutral", "name", false)
        if (Regex("occupied|occupancy").containsMatchIn(lower)) return Polarity("occupied", "vacant", "neutral", "neutral", "name", false)
        // ambiguous
        return Polarity("on", "off", "neutral", "neutral", "none", true)
    }

    private val OPPOSITE = mapOf(
        "open" to "closed", "closed" to "open", "muted" to "unmuted", "unmuted" to "muted",
        "locked" to "unlocked", "unlocked" to "locked", "detected" to "clear", "clear" to "detected",
        "occupied" to "vacant", "vacant" to "occupied", "tampered" to "ok", "ok" to "tampered",
        "running" to "idle", "idle" to "running", "private" to "normal", "normal" to "private",
        "home" to "away", "away" to "home", "wet" to "dry", "dry" to "wet",
        "unsafe" to "safe", "safe" to "unsafe",
    )

    private fun toneFor(value: String): String = when (value) {
        "tampered", "wet", "unsafe" -> "alert"
        "open", "unlocked", "muted" -> "warn"
        else -> "ok"
    }

    /** Suggests a polarity for an ambiguous facet based on device class / model. */
    fun suggestPolarity(deviceClass: String?, modelName: String?): String? {
        if (deviceClass != null && BY_DEVICE_CLASS.containsKey(deviceClass)) {
            return BY_DEVICE_CLASS[deviceClass]!!.on
        }
        return null
    }

    /** Suggests a polarity for an ambiguous facet based on device class. */
    fun suggestPolarity(deviceClass: String?): String? {
        if (deviceClass != null && BY_DEVICE_CLASS.containsKey(deviceClass)) {
            return BY_DEVICE_CLASS[deviceClass]!!.on
        }
        return null
    }

    fun describeThingFacets(thing: Thing, lookup: (String) -> EntityProjection?, onMeansFor: (String) -> String? = { null }): List<FacetValue> {
        return thing.facets.map { f ->
            describeFacet(f.key ?: "state", f.entityId, f.domain, f.deviceClass, f.name, lookup(f.entityId)?.state, onMeansFor(f.entityId))
        }
    }
}
