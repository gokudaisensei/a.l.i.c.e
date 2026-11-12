package alice.ha

object NameCleaner {
    private val SMALL = setOf("a", "an", "and", "of", "the", "in", "on", "to", "for")
    private val KEEP_UPPER = setOf("tv", "ac", "led", "usb", "uv", "co2", "pm", "ip", "dns", "nas", "hdmi", "rgb", "dc")
    private val WHITESPACE = Regex("\\s+")
    private val PREFIX_SEPARATOR = Regex("^[\\s\\-_:·]")
    private val LEADING_SEPARATORS = Regex("^[\\s\\-_:·]+")
    private val NONE_WORD = Regex("\\bnone\\b", RegexOption.IGNORE_CASE)
    private val TRAILING_NUMBER = Regex("\\s+\\d+$")
    private val SHORT_TRAILING_NUMBER = Regex("^\\s+[2-9]$")

    private fun collapse(s: String) = s.replace(WHITESPACE, " ").trim()

    fun fixCase(s: String): String {
        if (s != s.lowercase() && s != s.uppercase()) return s
        return s.lowercase().split(" ").mapIndexed { i, w ->
            if (KEEP_UPPER.contains(w)) w.uppercase()
            else if (i > 0 && SMALL.contains(w)) w
            else w.replaceFirstChar { it.uppercase() }
        }.joinToString(" ")
    }

    fun stripPrefix(text: String, prefix: String?): String {
        if (prefix.isNullOrBlank()) return text
        val p = prefix.trim().lowercase()
        val t = text.trim()
        if (p.isBlank() || t.lowercase() == p || !t.lowercase().startsWith(p)) return t
        val rest = t.substring(p.length)
        if (!PREFIX_SEPARATOR.containsMatchIn(rest)) return t
        return collapse(rest.replace(LEADING_SEPARATORS, ""))
    }

    fun scrub(text: String): String = collapse(
        text.replace("_", " ").replace(NONE_WORD, " ")
            .replace(TRAILING_NUMBER) { m -> if (SHORT_TRAILING_NUMBER.matches(m.value)) "" else m.value }
    )

    fun cleanEntityName(sourceName: String, ownName: String?, hasEntityName: Boolean, deviceName: String?, areaName: String?): String? {
        var n = if (hasEntityName && !ownName.isNullOrBlank()) ownName else sourceName
        n = scrub(n)
        n = stripPrefix(n, if (deviceName != null) scrub(deviceName) else null)
        n = stripPrefix(n, areaName)
        n = scrub(n)
        if (n.isBlank()) return null
        if (deviceName != null && n.lowercase() == scrub(deviceName).lowercase()) return null
        return fixCase(n)
    }

    fun cleanThingName(deviceName: String, areaName: String?): String {
        val n = scrub(stripPrefix(scrub(deviceName), areaName))
        return fixCase(n.ifBlank { deviceName })
    }

    private val SYNONYMS = mapOf(
        "light" to listOf("lamp", "bulb", "light"),
        "switch" to listOf("switch", "plug", "socket"),
        "media_player" to listOf("speaker", "tv", "player", "music"),
        "climate" to listOf("ac", "thermostat", "heater", "aircon"),
        "lock" to listOf("lock", "door"),
        "cover" to listOf("blind", "shade", "curtain", "shutter", "garage"),
        "fan" to listOf("fan"),
        "camera" to listOf("camera", "cam"),
        "vacuum" to listOf("vacuum", "robot"),
    )

    fun buildAliases(name: String, areaName: String?, domain: String): List<String> {
        val base = name.lowercase()
        val out = linkedSetOf(base)
        if (areaName != null) out.add("${areaName.lowercase()} $base")
        for (syn in SYNONYMS[domain] ?: emptyList()) {
            if (!base.contains(syn)) {
                out.add("$base $syn")
                if (areaName != null) out.add("${areaName.lowercase()} $syn")
            }
        }
        return out.toList()
    }
}
