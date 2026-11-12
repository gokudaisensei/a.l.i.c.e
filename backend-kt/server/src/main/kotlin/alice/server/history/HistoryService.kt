package alice.server.history

import alice.core.db.Database
import alice.core.ids.Ids
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.notFound
import alice.core.time.TimeProvider
import alice.ha.HaConnectionState
import alice.ha.HomeAssistantGateway
import alice.ha.StateNormalizer
import alice.ha.availabilityOf
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant

const val DAY_MS = 24L * 3_600_000L
const val MAX_RANGE_MS = 31L * DAY_MS

@Serializable
data class HistoryPoint(
    val at: Long,
    val state: String,
    val values: Map<String, kotlinx.serialization.json.JsonElement?> = emptyMap(),
    val availability: String,
)

@Serializable
data class DeviceHistory(
    val thingId: String,
    val entityId: String,
    val name: String,
    val from: Long,
    val to: Long,
    val points: List<HistoryPoint>,
    val totalPoints: Int,
    val downsampled: Boolean,
)

fun <T> downsample(points: List<T>, max: Int, at: (T) -> Long): List<T> {
    if (points.size <= max) return points
    val from = at(points.first())
    val span = (at(points.last()) - from).coerceAtLeast(1L)
    val buckets = linkedMapOf<Int, T>()
    for (p in points) {
        val idx = (((at(p) - from).toDouble() / span.toDouble()) * max).toInt().coerceIn(0, max - 1)
        buckets[idx] = p
    }
    val out = buckets.entries.sortedBy { it.key }.map { it.value }.toMutableList()
    if (out.isNotEmpty() && out.first() !== points.first()) {
        out.add(0, points.first())
        if (out.size > max) out.removeAt(1)
    }
    return out
}

fun parseTime(v: String?, fallback: Long): Long {
    if (v.isNullOrBlank()) return fallback
    val n = if (Regex("^\\d{10,}$").matches(v)) v.toLongOrNull() else runCatching { Instant.parse(v).toEpochMilli() }.getOrNull()
    if (n == null) throw AppException(ErrorCode.VALIDATION_ERROR, "\"$v\" is not a time", 400)
    return n
}

fun parseRange(from: String?, to: String?, now: Long): Pair<Long, Long> {
    val end = parseTime(to, now)
    val start = parseTime(from, end - DAY_MS)
    if (start >= end) throw AppException(ErrorCode.VALIDATION_ERROR, "The start must be before the end", 400)
    if (end - start > MAX_RANGE_MS) throw AppException(ErrorCode.VALIDATION_ERROR, "At most 31 days at a time", 400)
    return start to end
}

class HistoryService(
    private val db: Database,
    private val things: ThingsService,
    private val gateway: HomeAssistantGateway,
    private val time: TimeProvider,
) {
    suspend fun device(c: Caller, thingId: String, from: String?, to: String?, entityId: String?, maxPoints: Int?): DeviceHistory {
        val visible = things.visible(c, thingId)
        val view = visible.view
        val ents = buildList {
            view.primary?.let { add(it.entityId to it.name) }
            view.others.forEach { add(it.entityId to it.name) }
            view.controls.forEach { add(it.entityId to it.name) }
            view.sensors.forEach { add(it.entityId to it.name) }
            view.facets.forEach { add(it.entityId to it.label) }
        }
        val targetPair = (if (!entityId.isNullOrBlank()) ents.firstOrNull { it.first == entityId } else ents.firstOrNull())
            ?: if (!entityId.isNullOrBlank()) throw notFound("Entity") else throw AppException(ErrorCode.NOT_FOUND, "Nothing to show for this device", 404)
        val targetEntityId = targetPair.first
        val targetName = targetPair.second
        val (start, end) = parseRange(from, to, time.now())
        if (gateway.state != HaConnectionState.CONNECTED) throw AppException("ha_unreachable", "Home Assistant is not connected", 503)
        val rows = alice.core.concurrent.runCatchingNonCancellation { gateway.getHistory(listOf(targetEntityId), start, end)[targetEntityId].orEmpty() }.getOrDefault(emptyList())
        val domain = targetEntityId.substringBefore('.')
        val base = rows.mapNotNull { row ->
            val m = row as? Map<*, *> ?: return@mapNotNull null
            val at = (m["at"] as? Number)?.toLong() ?: return@mapNotNull null
            val state = m["state"]?.toString() ?: ""
            @Suppress("UNCHECKED_CAST")
            val attrs = (m["attributes"] as? Map<String, JsonElement>) ?: (m["attributes"] as? Map<String, Any?>)?.mapValues { (_, v) ->
                when (v) {
                    is JsonElement -> v
                    else -> kotlinx.serialization.json.JsonPrimitive(v?.toString() ?: "null")
                }
            } ?: emptyMap()
            val values = StateNormalizer.normalize(domain, state, attrs)
                .mapValues { (_, v) -> toJsonElement(v) }.toMutableMap()
            HistoryPoint(at, state, values, availabilityOf(state))
        }.sortedBy { it.at }.toMutableList()

        // Merge Alice-side attribute log (L75) for attributes HA recorder may not keep (e.g. brightness/colour)
        val extra = runCatching {
            db.read { coreQueries.selectEntityAttributeLog(c.householdId, targetEntityId, start, end).executeAsList() }
        }.getOrDefault(emptyList())
        if (extra.isNotEmpty()) {
            val byAt = base.associateBy { it.at }.toMutableMap()
            for (row in extra) {
                val vals = runCatching { Json.parseToJsonElement(row.values_json) as? kotlinx.serialization.json.JsonObject }.getOrNull() ?: continue
                val at = row.recorded_at
                val existing = byAt[at]
                if (existing != null) {
                    val merged = existing.values.toMutableMap()
                    vals.forEach { (k, v) -> if (merged[k] == null) merged[k] = v }
                    byAt[at] = existing.copy(values = merged)
                } else {
                    // find nearest state point for context
                    val nearest = base.minByOrNull { kotlin.math.abs(it.at - at) }
                    val state = nearest?.state ?: "unknown"
                    val merged = vals.mapValues { (_, v) -> v }.toMutableMap()
                    byAt[at] = HistoryPoint(at, state, merged, nearest?.availability ?: availabilityOf(state))
                }
            }
            base.clear(); base.addAll(byAt.values.sortedBy { it.at })
        }

        val all = base
        val max = (maxPoints ?: 300).coerceIn(10, 1000)
        val points = downsample(all, max) { it.at }
        val name = if (targetEntityId == view.primary?.entityId) view.name else "${view.name} $targetName"
        return DeviceHistory(thingId, targetEntityId, name, start, end, points, all.size, points.size < all.size)
    }

    fun recordAttributes(householdId: String, entityId: String, values: Map<String, Any?>, at: Long = time.now()) {
        val keep = values.filterValues { it != null }
        if (keep.isEmpty()) return
        val json = kotlinx.serialization.json.buildJsonObject {
            keep.forEach { (k, v) ->
                when (v) {
                    is Boolean -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                    is Number -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                    is String -> put(k, kotlinx.serialization.json.JsonPrimitive(v))
                    else -> put(k, kotlinx.serialization.json.JsonPrimitive(v.toString()))
                }
            }
        }.toString()
        runCatching {
            db.write { coreQueries.insertEntityAttributeLog(Ids.next("eal"), householdId, entityId, json, at) }
        }
    }

    private fun toJsonElement(v: Any?): JsonElement? = when (v) {
        null -> null
        is Boolean -> kotlinx.serialization.json.JsonPrimitive(v)
        is Number -> kotlinx.serialization.json.JsonPrimitive(v)
        is String -> kotlinx.serialization.json.JsonPrimitive(v)
        is Map<*, *> -> kotlinx.serialization.json.JsonObject(v.entries.associate { (k, vv) -> k.toString() to (toJsonElement(vv) ?: kotlinx.serialization.json.JsonPrimitive("null")) })
        is List<*> -> kotlinx.serialization.json.JsonArray(v.map { toJsonElement(it) ?: kotlinx.serialization.json.JsonPrimitive("null") })
        else -> kotlinx.serialization.json.JsonPrimitive(v.toString())
    }
}
