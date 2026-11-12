package alice.ha

object RoleClassifier {
    val PRIMARY_DOMAINS = listOf("media_player", "climate", "light", "lock", "cover", "fan", "vacuum", "humidifier", "water_heater", "alarm_control_panel", "valve", "siren", "remote", "camera")
    private val STANDALONE_PRIMARY = setOf("scene", "script", "input_boolean", "input_number", "input_select", "person", "weather", "device_tracker", "automation")
    private val SYSTEM_DOMAINS = setOf("zone", "conversation", "tts", "stt", "notify", "todo", "calendar", "image_processing", "geo_location", "event")
    private val CONTROL_DOMAINS = setOf("switch", "select", "number", "button", "text", "time", "datetime", "date", "input_text", "input_datetime", "input_button")
    private val DIAGNOSTIC_TOKENS = Regex("\\b(wi-?fi|rssi|signal|uptime|ip address|mac address|ssid|firmware|version|last seen|last boot|restart|reboot|identify|memory|cpu|free heap|connected)\\b", RegexOption.IGNORE_CASE)
    private val FACET_TOKENS = Regex("\\b(shutter|privacy|muted|mute state|tamper|lid|cover open|door open|open state|occupied|presence|motion)\\b", RegexOption.IGNORE_CASE)
    private val FACET_DEVICE_CLASSES = setOf("tamper", "motion", "occupancy", "presence", "opening", "door", "window", "garage_door", "lock", "safety", "smoke", "moisture", "vibration", "sound", "running", "privacy")
    private val DIAGNOSTIC_DEVICE_CLASSES = setOf("signal_strength", "timestamp", "duration", "data_size", "connectivity", "update", "firmware")

    data class RoleResult(val role: EntityRole, val reason: String)

    data class RoleContext(val name: String, val deviceHasPrimaryDomain: Boolean, val hasDevice: Boolean)

    fun classifyRole(e: InventoryEntity, ctx: RoleContext): RoleResult {
        if (e.entityCategory == "diagnostic") return RoleResult(EntityRole.diagnostic, "entity_category=diagnostic")
        if (e.entityCategory == "config") return RoleResult(EntityRole.config, "entity_category=config")
        if (SYSTEM_DOMAINS.contains(e.domain)) return RoleResult(EntityRole.config, "${e.domain} is plumbing")
        if (e.domain == "update") return RoleResult(EntityRole.diagnostic, "update entity")
        if (e.deviceClass != null && DIAGNOSTIC_DEVICE_CLASSES.contains(e.deviceClass)) return RoleResult(EntityRole.diagnostic, "device_class=${e.deviceClass}")
        if (PRIMARY_DOMAINS.contains(e.domain)) return RoleResult(EntityRole.primary, "${e.domain} domain")
        if (!ctx.hasDevice && STANDALONE_PRIMARY.contains(e.domain)) return RoleResult(EntityRole.primary, "standalone ${e.domain}")
        if (DIAGNOSTIC_TOKENS.containsMatchIn(ctx.name)) return RoleResult(EntityRole.diagnostic, "name looks diagnostic")
        if (e.domain == "binary_sensor") {
            if (e.deviceClass != null && FACET_DEVICE_CLASSES.contains(e.deviceClass)) return RoleResult(EntityRole.facet, "binary_sensor device_class=${e.deviceClass}")
            if (FACET_TOKENS.containsMatchIn(ctx.name)) return RoleResult(EntityRole.facet, "name looks like a state of the device")
            return RoleResult(EntityRole.sensor, "binary_sensor")
        }
        if (e.domain == "sensor") return RoleResult(EntityRole.sensor, "sensor domain")
        if (CONTROL_DOMAINS.contains(e.domain)) {
            return RoleResult(EntityRole.control, if (ctx.deviceHasPrimaryDomain || e.domain != "switch") "${e.domain} on a device with a primary" else "switch; may be promoted to primary")
        }
        if (STANDALONE_PRIMARY.contains(e.domain)) return RoleResult(EntityRole.control, "${e.domain} on a device")
        return RoleResult(EntityRole.sensor, "no rule matched")
    }

    fun primaryRank(e: InventoryEntity): Int {
        val i = PRIMARY_DOMAINS.indexOf(e.domain)
        return if (i == -1) 99 else i
    }

    fun promotionRank(e: InventoryEntity): Int = when (e.domain) {
        "switch", "input_boolean" -> 0
        "binary_sensor" -> 1
        "sensor" -> 2
        "number", "select", "button" -> 3
        else -> 9
    }

    fun facetKey(name: String): String {
        val k = name.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')
        if (Regex("shutter").containsMatchIn(k)) return "privacy_shutter"
        if (Regex("mute").containsMatchIn(k)) return "mic_muted"
        return k.ifBlank { "state" }
    }
}
