package alice.server.energy

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.time.TimeProvider
import alice.ha.HaConnectionState
import alice.ha.HomeAssistantGateway
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.round

const val DAY_MS = 24L * 3_600_000L

fun toWatts(v: Double, unit: Any?): Double = when (unit?.toString()) {
    "kW" -> v * 1000.0
    "MW" -> v * 1_000_000.0
    "mW" -> v / 1000.0
    else -> v
}
fun toKwh(v: Double, unit: Any?): Double = when (unit?.toString()) {
    "Wh" -> v / 1000.0
    "MWh" -> v * 1000.0
    "GJ" -> v * 277.778
    else -> v
}
fun roundN(n: Double, d: Int = 3): Double { val p = Math.pow(10.0, d.toDouble()); return round(n * p) / p }

fun parseTimeEnergy(v: String?, fallback: Long): Long {
    if (v.isNullOrBlank()) return fallback
    val n = if (Regex("^\\d{10,}$").matches(v)) v.toLongOrNull() else runCatching { Instant.parse(v).toEpochMilli() }.getOrNull()
    if (n == null) throw AppException(ErrorCode.VALIDATION_ERROR, "\"$v\" is not a time", 400)
    return n
}

fun startOfLocalDay(now: Long, timezone: String): Long {
    val tz = runCatching { ZoneId.of(timezone) }.getOrDefault(ZoneId.of("UTC"))
    val zdt = Instant.ofEpochMilli(now).atZone(tz)
    return zdt.toLocalDate().atStartOfDay(tz).toInstant().toEpochMilli()
}

@Serializable data class DeviceEnergy(val thingId: String, val name: String, val watts: Double?, val todayKwh: Double?, val limitW: Int?, val percentOfLimit: Int?)
@Serializable data class EnergySummary(val nowWatts: Double, val todayKwh: Double?, val since: Long, val statisticsAvailable: Boolean, val monitoredDevices: Int, val topToday: List<DeviceEnergy>)
@Serializable data class EnergySeriesPoint(val start: Long, val kwh: Double)
@Serializable data class EnergyDeviceHistory(val thingId: String, val name: String, val kwh: Double, val series: List<EnergySeriesPoint>)
@Serializable data class EnergyHistory(val from: Long, val to: Long, val resolution: String, val totalKwh: Double, val series: List<EnergySeriesPoint>, val devices: List<EnergyDeviceHistory>)
@Serializable data class EnergyPattern(val sentence: String, val percent: Int, val weekday: String, val weeks: Int, val kwh: Double)
@Serializable data class EnergyDevices(val devices: List<DeviceEnergy>, val statisticsAvailable: Boolean)

private data class Meter(
    val thingId: String,
    val name: String,
    val connectionId: String,
    val powerSensor: String?,
    val energySensor: String?,
    val watts: Double?,
    val unit: String?,
    val primaryEntityId: String?,
)

class EnergyService(
    private val db: Database,
    private val things: ThingsService,
    private val gateway: HomeAssistantGateway,
    private val time: TimeProvider,
) {
    private fun timezone(householdId: String): String =
        db.read { identityQueries.selectHouseholdById(householdId).executeAsOneOrNull() }?.timezone ?: "UTC"

    private suspend fun meters(c: Caller): List<Meter> {
        val out = mutableListOf<Meter>()
        val all = things.things(c.householdId, includeHidden = true)
        for (t in all) {
            val visible = runCatching { things.visible(c, t.id) }.getOrNull() ?: continue
            val v = visible.view
            val sensors = buildList {
                v.primary?.let { add(it) }
                addAll(v.sensors)
            }
            fun klass(e: alice.ha.EntityView): String? = (e.values["sensor"] as? Map<*, *>)?.get("deviceClass")?.toString()
            val power = sensors.firstOrNull { klass(it) == "power" }
            val energy = sensors.firstOrNull { klass(it) == "energy" }
            if (power == null && energy == null) continue
            val reading = power?.let { (it.values["sensor"] as? Map<*, *>) }
            val watts = (reading?.get("value") as? Number)?.toDouble()?.let { roundN(toWatts(it, reading["unit"]), 0) }
            val eUnit = energy?.let { (it.values["sensor"] as? Map<*, *>)?.get("unit")?.toString() }
            out += Meter(v.id, v.name, alice.ha.Connections.DEFAULT_ID, power?.entityId, energy?.entityId, watts, eUnit, v.primary?.entityId)
        }
        return out
    }

    private suspend fun consumption(c: Caller, meters: List<Meter>, from: Long, to: Long, period: String): Map<String, List<Pair<Long, Double?>>>? {
        val wanted = meters.filter { it.energySensor != null }
        if (wanted.isEmpty()) return emptyMap()
        if (gateway.state != HaConnectionState.CONNECTED) return null
        val ids = wanted.map { it.energySensor!! }
        val stats = alice.core.concurrent.runCatchingNonCancellation { gateway.getStatistics(ids, from, to, period) }.getOrNull() ?: return null
        val out = mutableMapOf<String, List<Pair<Long, Double?>>>()
        for (m in wanted) {
            val rows = stats[m.energySensor!!].orEmpty()
            out[m.thingId] = rows.mapNotNull { row ->
                val obj = row as? JsonObject ?: (row as? Map<*, *>)?.let { mapToJsonObject(it) } ?: return@mapNotNull null
                val start = obj["start"]?.jsonPrimitive?.content?.toLongOrNull()
                    ?: obj["start"]?.jsonPrimitive?.content?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
                    ?: return@mapNotNull null
                val change = obj["change"]?.jsonPrimitive?.content?.toDoubleOrNull()
                val kwh = change?.let { roundN(toKwh(it, m.unit), 4) }
                start to kwh
            }
        }
        return out
    }

    private fun mapToJsonObject(m: Map<*, *>): JsonObject {
        return kotlinx.serialization.json.buildJsonObject {
            m.forEach { (k, v) ->
                when (v) {
                    null -> put(k.toString(), kotlinx.serialization.json.JsonNull)
                    is Number -> put(k.toString(), JsonPrimitive(v))
                    is Boolean -> put(k.toString(), JsonPrimitive(v))
                    else -> put(k.toString(), JsonPrimitive(v.toString()))
                }
            }
        }
    }

    private fun sum(points: List<Pair<Long, Double?>>?): Double = roundN((points.orEmpty()).sumOf { it.second ?: 0.0 })

    private fun limitFor(householdId: String, connectionId: String, entityIds: List<String>): Int? {
        for (id in entityIds) {
            val r = db.read { identityQueries.selectEntitySettings(householdId, connectionId, id).executeAsOneOrNull() }
            val l = r?.power_limit_w?.toInt()
            if (l != null && l > 0) return l
        }
        return null
    }

    suspend fun summary(c: Caller): EnergySummary {
        val meters = meters(c)
        val now = time.now()
        val from = startOfLocalDay(now, timezone(c.householdId))
        val stats = consumption(c, meters, from, now + 3_600_000, "hour")
        val per = meters.map { m ->
            val today = stats?.let { sum(it[m.thingId]) }
            DeviceEnergy(m.thingId, m.name, m.watts, today, null, null)
        }
        val withStats = per.filter { (it.todayKwh ?: 0.0) > 0.0 }
        val todayKwh = stats?.let { roundN(withStats.sumOf { it.todayKwh ?: 0.0 }) }
        return EnergySummary(
            nowWatts = roundN(meters.sumOf { it.watts ?: 0.0 }, 0),
            todayKwh = todayKwh,
            since = from,
            statisticsAvailable = stats != null,
            monitoredDevices = meters.size,
            topToday = withStats.sortedByDescending { it.todayKwh ?: 0.0 }.take(3),
        )
    }

    suspend fun history(c: Caller, from: String?, to: String?, resolution: String?): EnergyHistory {
        val res = if (resolution == "day") "day" else "hour"
        val end = parseTimeEnergy(to, time.now())
        val start = parseTimeEnergy(from, end - if (res == "hour") DAY_MS else 30L * DAY_MS)
        val maxSpan = if (res == "hour") 7L * DAY_MS else 366L * DAY_MS
        if (start >= end) throw AppException(ErrorCode.VALIDATION_ERROR, "The start must be before the end", 400)
        if (end - start > maxSpan) throw AppException(ErrorCode.VALIDATION_ERROR, if (res == "hour") "Hourly figures cover at most 7 days; ask for days instead" else "At most 366 days at a time", 400)
        val meters = meters(c)
        val stats = consumption(c, meters, start, end, res) ?: throw AppException("ha_unreachable", "Home Assistant could not be asked for energy figures", 503)
        val total = linkedMapOf<Long, Double>()
        for (pts in stats.values) for ((s, k) in pts) total[s] = roundN((total[s] ?: 0.0) + (k ?: 0.0), 4)
        val series = total.entries.sortedBy { it.key }.map { EnergySeriesPoint(it.key, it.value) }
        val devices = meters.filter { it.energySensor != null }.map { m ->
            val pts = stats[m.thingId].orEmpty()
            EnergyDeviceHistory(m.thingId, m.name, sum(pts), pts.map { EnergySeriesPoint(it.first, it.second ?: 0.0) })
        }.sortedByDescending { it.kwh }
        return EnergyHistory(start, end, res, roundN(series.sumOf { it.kwh }), series, devices)
    }

    suspend fun deviceList(c: Caller): EnergyDevices {
        val meters = meters(c)
        val now = time.now()
        val stats = consumption(c, meters, startOfLocalDay(now, timezone(c.householdId)), now + 3_600_000, "hour")
        val devices = meters.map { m ->
            val ids = listOfNotNull(m.primaryEntityId, m.powerSensor)
            val limit = limitFor(c.householdId, m.connectionId, ids)
            val today = if (stats != null && m.energySensor != null) sum(stats[m.thingId]) else null
            val pct = if (limit != null && m.watts != null) round((m.watts / limit) * 100.0).toInt() else null
            DeviceEnergy(m.thingId, m.name, m.watts, today, limit, pct)
        }.sortedWith(compareByDescending<DeviceEnergy> { it.todayKwh ?: -1.0 }.thenByDescending { it.watts ?: -1.0 })
        return EnergyDevices(devices, stats != null)
    }

    suspend fun pattern(c: Caller): EnergyPattern? {
        val tzName = timezone(c.householdId)
        val now = time.now()
        val meters = meters(c)
        if (meters.none { it.energySensor != null }) return null
        val tz = runCatching { ZoneId.of(tzName) }.getOrDefault(ZoneId.of("UTC"))
        fun hourOf(t: Long): Int = Instant.ofEpochMilli(t).atZone(tz).hour
        val today = startOfLocalDay(now, tzName)
        val target = if (hourOf(now) >= 23) today else today - DAY_MS
        suspend fun evening(dayStart: Long): Double? {
            val stats = consumption(c, meters, dayStart, dayStart + DAY_MS, "hour") ?: return null
            var kwh = 0.0; var any = false
            for (pts in stats.values) for ((s, k) in pts) {
                val h = hourOf(s)
                if (h in 17..22 && k != null) { kwh += k; any = true }
            }
            return if (any) kwh else null
        }
        val was = evening(target) ?: return null
        val base = mutableListOf<Double>()
        for (k in 1..8) {
            val v = evening(target - 7L * k * DAY_MS)
            if (v != null && v > 0.0) base += v
        }
        if (base.size < 3) return null
        val avg = base.average()
        if (avg == 0.0) return null
        val percent = round(((was - avg) / avg) * 100.0).toInt()
        if (abs(percent) < 10) return null
        val weekday = DateTimeFormatter.ofPattern("EEEE", Locale.ENGLISH).withZone(tz).format(Instant.ofEpochMilli(target + 12L * 3_600_000L))
        val day = if (target == today) "This evening" else "Last evening"
        val sentence = "$day ran ${abs(percent)}% ${if (percent > 0) "above" else "below"} your last ${base.size} ${weekday}s. Plain statistics, no guessing."
        return EnergyPattern(sentence, percent, weekday, base.size, roundN(was))
    }
}
