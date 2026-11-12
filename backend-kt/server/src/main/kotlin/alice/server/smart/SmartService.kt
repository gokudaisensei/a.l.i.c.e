package alice.server.smart

import alice.core.db.Database
import alice.core.time.TimeProvider
import alice.ha.Presentation
import alice.ha.StateCache
import alice.ha.Thing
import alice.ha.ThingView
import alice.server.things.Caller
import alice.server.notifications.AlertsService
import alice.server.things.ThingsService
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.pow

@Serializable data class HomeResponse(
    val generation: Int,
    val serverTime: Long,
    val household: HomeHousehold,
    val room: HomeRoom?,
    val alerts: HomeAlerts,
    val devices: List<HomeDevice>,
    val scenes: List<HomeSceneChip>,
    val usual: List<HomeUsual>,
    val search: HomeSearchHints,
)
@Serializable data class HomeHousehold(val id: String, val mode: String, val timeZone: String)
@Serializable data class HomeRoom(val id: String?, val name: String?, val reason: String)
@Serializable data class HomeAlerts(val count: Int, val highest: String?)
@Serializable data class HomeDeviceHints(val confirmIntent: Boolean, val defaultParams: Map<String, kotlinx.serialization.json.JsonElement>)
@Serializable data class HomeDevice(
    val id: String, val name: String, val areaId: String?, val kind: String,
    val state: Map<String, kotlinx.serialization.json.JsonElement>,
    val hints: HomeDeviceHints,
)
@Serializable data class HomeSceneChip(val id: String, val name: String, val reason: String)
@Serializable data class HomeUsual(val kind: String, val id: String, val name: String)
@Serializable data class HomeSearchHints(val suggestions: List<String>)
@Serializable data class SearchResponse(val results: List<SearchResult>, val usual: List<HomeUsual>, val suggestions: List<String>)
@Serializable data class SearchResult(val kind: String, val id: String, val name: String, val areaId: String? = null, val score: Double = 0.0)
@Serializable data class WhyResponse(val thingId: String, val action: String, val confirmIntent: Boolean, val regretRate: Double, val commands: Double, val undos: Double, val factors: List<String>)
@Serializable data class OrderAckRequest(val generation: Int)

class SmartService(
    private val db: Database,
    private val things: ThingsService,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
    private val smartConfig: alice.core.config.SmartConfig = alice.core.config.SmartConfig(),
    private val favorites: alice.server.favorites.FavoritesService? = null,
    private val alertsService: AlertsService? = null,
    private val stateCache: StateCache? = null,
) {
    private val halfLifeMs = 21L * 24 * 60 * 60 * 1000
    private val decay90dMs = 90L * 24 * 60 * 60 * 1000
    private val maxMove = 2
    private val hysteresisPct = 0.15
    private val minReorderMs = 15L * 60 * 1000

    private fun decay(value: Double, deltaMs: Long): Double = if (deltaMs <= 0) value else value * 0.5.pow(deltaMs.toDouble() / halfLifeMs.toDouble())
    fun hourBucket(now: Long, tz: String): Int = try { Instant.ofEpochMilli(now).atZone(ZoneId.of(tz)).hour } catch (_: Exception) { Instant.ofEpochMilli(now).atZone(ZoneId.of("UTC")).hour }

    fun recordView(householdId: String, userId: String, thingId: String, tz: String = "UTC") = record(householdId, userId, thingId, tz, view = 1.0)
    fun recordCommand(householdId: String, userId: String, thingId: String, tz: String = "UTC") = record(householdId, userId, thingId, tz, command = 1.0)
    fun recordUndo(householdId: String, userId: String, thingId: String, tz: String = "UTC") = record(householdId, userId, thingId, tz, undo = 1.0)

    private fun record(householdId: String, userId: String, thingId: String, tz: String, view: Double = 0.0, command: Double = 0.0, undo: Double = 0.0) {
        val now = time.now()
        val hb = hourBucket(now, tz)
        val existing = db.read { identityQueries.selectInteractionStatsForThing(householdId, userId, thingId).executeAsList().firstOrNull { it.hour_bucket.toInt() == hb } }
        val delta = if (existing != null) now - existing.updated_at else 0L
        val views = decay(existing?.views ?: 0.0, delta) + view
        val commands = decay(existing?.commands ?: 0.0, delta) + command
        val undos = decay(existing?.undos ?: 0.0, delta) + undo
        db.write { identityQueries.upsertInteractionStat(householdId, userId, thingId, hb.toLong(), views, commands, undos, now, now) }
    }

    fun rememberDefault(householdId: String, userId: String, thingId: String, action: String, paramsJson: String) {
        val now = time.now()
        val existing = db.read { identityQueries.selectActionDefault(householdId, userId, thingId, action).executeAsOneOrNull() }
        db.write { identityQueries.upsertActionDefault(householdId, userId, thingId, action, paramsJson, (existing?.uses ?: 0) + 1, now) }
    }

    fun recordQuery(householdId: String, userId: String, query: String) {
        val norm = normalize(query)
        if (norm.isBlank()) return
        val now = time.now()
        val existing = db.read { identityQueries.selectQueryHistory(householdId, userId, 50).executeAsList().firstOrNull { it.query_norm == norm } }
        db.write { identityQueries.upsertQueryHistory(householdId, userId, norm, (existing?.hits ?: 0) + 1, now) }
    }

    fun recordSceneRun(householdId: String, userId: String, sceneId: String, tz: String = "UTC") {
        val now = time.now()
        val hb = hourBucket(now, tz)
        val existing = db.read { identityQueries.selectSceneUsage(householdId, userId).executeAsList().firstOrNull { it.scene_id == sceneId && it.hour_bucket.toInt() == hb } }
        val delta = if (existing != null) now - existing.last_run_at else 0L
        val runs = decay(existing?.runs ?: 0.0, delta) + 1.0
        db.write { identityQueries.upsertSceneUsage(householdId, userId, sceneId, hb.toLong(), runs, now) }
    }

    private fun hourWeight(statHour: Int, nowHour: Int): Double = when {
        statHour == nowHour -> 1.0
        (statHour + 1) % 24 == nowHour || (nowHour + 1) % 24 == statHour -> 0.5
        else -> 0.0
    }

    private data class Score(val thingId: String, val score: Double, val lastUsedAt: Long)
    private fun scores(householdId: String, userId: String, now: Long, tz: String): Map<String, Score> {
        val hb = hourBucket(now, tz)
        val stats = db.read { identityQueries.selectInteractionStats(householdId, userId).executeAsList() }
        return stats.groupBy { it.thing_id }.mapValues { (thingId, rows) ->
            var views = 0.0; var commands = 0.0; var undos = 0.0; var last = 0L
            for (r in rows) {
                val w = hourWeight(r.hour_bucket.toInt(), hb)
                if (w == 0.0) continue
                views += r.views * w; commands += r.commands * w; undos += r.undos * w
                if (r.last_used_at > last) last = r.last_used_at
            }
            val hoursSince = if (last == 0L) 9999.0 else (now - last).toDouble() / 3_600_000.0
            val recency = 0.5.pow(hoursSince / 72.0)
            Score(thingId, 3.0 * commands + 1.5 * views + 1.0 * recency - 0.5 * undos, last)
        }
    }

    private fun regretRate(householdId: String, userId: String, thingId: String): Triple<Boolean, Double, Pair<Double, Double>> {
        val rows = db.read { identityQueries.selectInteractionStatsForThing(householdId, userId, thingId).executeAsList() }
        var cmds = 0.0; var undos = 0.0; val now = time.now()
        for (r in rows) { val d = now - r.updated_at; cmds += decay(r.commands, d); undos += decay(r.undos, d) }
        if (cmds < 5.0) return Triple(false, 0.0, cmds to undos)
        val rate = undos / max(1.0, cmds)
        return Triple(rate >= 0.30, rate, cmds to undos)
    }

    fun confirmIntent(householdId: String, userId: String, thingId: String): Boolean = regretRate(householdId, userId, thingId).first

    fun defaultParams(householdId: String, userId: String, thingId: String): Map<String, kotlinx.serialization.json.JsonElement> {
        val now = time.now()
        val rows = db.read { identityQueries.selectActionDefaultsForUser(householdId, userId).executeAsList() }
            .filter { it.thing_id == thingId && now - it.last_used_at <= decay90dMs }
            .sortedByDescending { it.last_used_at }
        val first = rows.firstOrNull() ?: return emptyMap()
        return try { json.decodeFromString<Map<String, kotlinx.serialization.json.JsonElement>>(first.params) } catch (_: Exception) { emptyMap() }
    }

    private fun kindOf(t: Thing): String = t.primary?.domain ?: t.others.firstOrNull()?.domain ?: "device"
    private fun toJson(v: Any?): kotlinx.serialization.json.JsonElement = when (v) {
        null -> kotlinx.serialization.json.JsonNull
        is kotlinx.serialization.json.JsonElement -> v
        is Boolean -> kotlinx.serialization.json.JsonPrimitive(v)
        is Number -> kotlinx.serialization.json.JsonPrimitive(v)
        is String -> kotlinx.serialization.json.JsonPrimitive(v)
        is Map<*, *> -> kotlinx.serialization.json.JsonObject(v.entries.associate { it.key.toString() to toJson(it.value) })
        is Iterable<*> -> kotlinx.serialization.json.JsonArray(v.map { toJson(it) })
        else -> kotlinx.serialization.json.JsonPrimitive(v.toString())
    }
    private fun stateOf(view: ThingView?): Map<String, kotlinx.serialization.json.JsonElement> = (view?.primary?.values ?: emptyMap()).mapValues { (_, v) -> toJson(v) }

    suspend fun home(caller: Caller, tz: String = "UTC", mode: String = "home"): HomeResponse {
        val now = time.now()
        val hb = hourBucket(now, tz)
        val allThings = things.things(caller.householdId, includeHidden = false)
        val deviceViews = allThings.filter { !it.hidden }.mapNotNull { t ->
            val view = runCatching { Presentation.presentThing(t, { id -> stateCache?.get(id) }, { eid -> things.canSee(caller, alice.ha.Connections.DEFAULT_ID, eid) }, false) }.getOrNull()
            if (view == null) null else t to view
        }
        val favIds = favorites?.idsFor(caller.userId)?.toSet() ?: emptySet()
        val sc = if (smartConfig.ordering) scores(caller.householdId, caller.userId, now, tz) else emptyMap()
        val desired = deviceViews.sortedWith(
            compareByDescending<Pair<Thing, ThingView>> { if (it.first.id in favIds) 1 else 0 }
                .thenByDescending { if (smartConfig.ordering) sc[it.first.id]?.score ?: 0.0 else 0.0 }
                .thenByDescending { if (smartConfig.ordering) sc[it.first.id]?.lastUsedAt ?: 0L else 0L }
                .thenBy { it.first.name }
        ).map { it.first.id }

        val prev = db.read { identityQueries.selectHomeOrder(caller.householdId, caller.userId).executeAsOneOrNull() }
        val prevOrder = prev?.order_json?.let { runCatching { json.decodeFromString<List<String>>(it) }.getOrNull() } ?: emptyList()
        val canReorder = prev == null || (now - prev.issued_at >= minReorderMs)
        val finalOrder = if (!smartConfig.ordering) desired else if (!canReorder && prevOrder.isNotEmpty()) applyHysteresis(prevOrder, desired, sc) else desired
        val generation = if (finalOrder != prevOrder) ((prev?.generation?.toInt() ?: 0) + 1) else (prev?.generation?.toInt() ?: 1)
        if (smartConfig.ordering && (finalOrder != prevOrder || prev == null)) {
            db.write { identityQueries.upsertHomeOrder(caller.householdId, caller.userId, generation.toLong(), json.encodeToString(finalOrder), now) }
        }

        val byId = deviceViews.associateBy { it.first.id }
        val devices = finalOrder.mapNotNull { id ->
            val pair = byId[id] ?: return@mapNotNull null
            val t = pair.first; val v = pair.second
            HomeDevice(t.id, t.name, t.areaId, kindOf(t), stateOf(v), HomeDeviceHints(if (smartConfig.hints) confirmIntent(caller.householdId, caller.userId, t.id) else false, if (smartConfig.hints) defaultParams(caller.householdId, caller.userId, t.id) else emptyMap()))
        }

        return HomeResponse(
            generation = generation, serverTime = now,
            household = HomeHousehold(caller.householdId, mode, tz),
            room = null,
            alerts = run {
                val list = alertsService?.list(caller, includeCleared = false) ?: emptyList()
                val highest = when { list.any { it.kind == "left_open" || it.data.toString().contains("tamper") } -> "warning"; list.isNotEmpty() -> "info"; else -> null }
                HomeAlerts(list.size, highest)
            },
            devices = devices,
            scenes = if (smartConfig.scenes) sceneChips(caller.householdId, caller.userId, hb) else emptyList(),
            usual = usual(caller, tz, 4),
            search = HomeSearchHints(db.read { identityQueries.selectQueryHistory(caller.householdId, caller.userId, 3).executeAsList() }.map { it.query_norm }),
        )
    }

    private fun applyHysteresis(prev: List<String>, desired: List<String>, sc: Map<String, Score>): List<String> {
        val set = desired.toSet()
        val result = prev.filter { it in set }.toMutableList()
        for (id in desired) if (id !in result) result.add(id)
        val desiredPos = desired.withIndex().associate { it.value to it.index }
        // conservative: keep previous unless >=15% advantage; move at most 2 positions
        val snapshot = result.toList()
        for (id in desired) {
            val cur = result.indexOf(id); val want = desiredPos[id] ?: continue
            if (cur <= 0 || want >= cur) continue
            val neighbor = snapshot.getOrNull(cur - 1) ?: continue
            val sId = sc[id]?.score ?: 0.0; val sN = sc[neighbor]?.score ?: 0.0
            val advantage = if (kotlin.math.abs(sN) < 0.0001) if (sId > sN) 1.0 else 0.0 else (sId - sN) / kotlin.math.abs(sN)
            if (advantage >= hysteresisPct) {
                val steps = minOf(maxMove, cur - want)
                result.removeAt(cur); result.add(maxOf(0, cur - steps), id)
            }
        }
        return result.filter { it in set }
    }

    suspend fun usual(caller: Caller, tz: String = "UTC", limit: Int = 4): List<HomeUsual> {
        val now = time.now()
        val sc = scores(caller.householdId, caller.userId, now, tz)
        return things.things(caller.householdId).filter { !it.hidden }
            .sortedByDescending { sc[it.id]?.score ?: 0.0 }.take(limit)
            .map { HomeUsual("thing", it.id, it.name) }
    }

    fun sceneChips(householdId: String, userId: String, hour: Int): List<HomeSceneChip> {
        val rows = db.read { identityQueries.selectSceneUsage(householdId, userId).executeAsList() }
        return rows.groupBy { it.scene_id }.mapNotNull { (sceneId, rs) ->
            var score = 0.0
            for (r in rs) {
                val h = r.hour_bucket.toInt()
                val w = when { h == hour -> 1.0; (h + 1) % 24 == hour || (hour + 1) % 24 == h -> 0.5; else -> 0.0 }
                score += r.runs * w
            }
            if (score < 3.0) null else sceneId to score
        }.sortedByDescending { it.second }.take(3).map { HomeSceneChip(it.first, it.first, "time-window") }
    }

    fun why(householdId: String, userId: String, thingId: String, action: String): WhyResponse {
        val (ci, rate, pair) = regretRate(householdId, userId, thingId)
        return WhyResponse(thingId, action, ci, rate, pair.first, pair.second, listOf("undo_rate=${"%.2f".format(rate)}", "commands=${"%.2f".format(pair.first)}", "undos=${"%.2f".format(pair.second)}"))
    }

    suspend fun search(caller: Caller, q: String?, tz: String = "UTC"): SearchResponse {
        val now = time.now()
        val usual = usual(caller, tz, 4)
        val suggestions = if (smartConfig.search) db.read { identityQueries.selectQueryHistory(caller.householdId, caller.userId, 3).executeAsList() }.map { it.query_norm } else emptyList()
        if (q.isNullOrBlank()) return SearchResponse(emptyList(), usual, suggestions)
        if (smartConfig.search) recordQuery(caller.householdId, caller.userId, q)
        val nq = normalize(q)
        val sc = if (smartConfig.ordering) scores(caller.householdId, caller.userId, now, tz) else emptyMap()
        val results = things.things(caller.householdId).filter { !it.hidden }.mapNotNull { t ->
            val hay = normalize("${t.name} ${t.aliases.joinToString(" ")} ${t.manufacturer ?: ""} ${t.model ?: ""}")
            val rank = if (smartConfig.search) rank(hay, nq) else if (hay.contains(nq)) 1.0 else 0.0
            if (rank <= 0.0) null else SearchResult("thing", t.id, t.name, t.areaId, rank + (sc[t.id]?.score ?: 0.0) * 0.1)
        }.sortedByDescending { it.score }.take(20)
        return SearchResponse(results, usual, suggestions)
    }

    fun normalize(s: String): String = Normalizer.normalize(s, Normalizer.Form.NFKD)
        .replace(Regex("\\p{M}"), "").lowercase().replace(Regex("\\s+"), " ").trim()
    private fun trigrams(s: String): Set<String> { val p = "  $s  "; return if (p.length < 3) emptySet() else (0..p.length - 3).map { p.substring(it, it + 3) }.toSet() }
    private fun jaccard(a: Set<String>, b: Set<String>): Double = if (a.isEmpty() || b.isEmpty()) 0.0 else a.intersect(b).size.toDouble() / a.union(b).size.toDouble()
    private fun rank(hay: String, nq: String): Double {
        if (hay == nq) return 10.0
        if (hay.startsWith(nq)) return 8.0
        val tokens = nq.split(" ").filter { it.isNotBlank() }
        if (tokens.isNotEmpty() && tokens.all { hay.contains(it) }) return 6.0
        val sim = jaccard(trigrams(hay), trigrams(nq))
        return if (sim >= 0.45) 2.0 + sim * 2.0 else 0.0
    }
}
