package alice.server.notifications

import alice.core.db.Database
import alice.core.error.notFound
import alice.core.events.AlertCleared
import alice.core.events.AlertCreated
import alice.core.events.EventBus
import alice.core.ids.Ids
import alice.core.time.TimeProvider
import alice.ha.HomeAssistantGateway
import alice.server.things.Caller
import alice.server.things.ThingsService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

@Serializable
data class AlertView(
    val id: String,
    val kind: String,
    val title: String,
    val detail: String,
    val thingId: String? = null,
    val thingName: String? = null,
    val data: JsonElement? = null,
    val createdAt: Long,
    val clearedAt: Long? = null,
    val ackedAt: Long? = null,
)

class AlertsService(
    private val db: Database,
    private val bus: EventBus,
    private val things: ThingsService,
    private val notifications: NotificationsService,
    private val time: TimeProvider,
    private val gateway: HomeAssistantGateway? = null,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false },
    private val activity: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
) {
    companion object {
        const val RAISE_AT = 0.9
        const val CLEAR_BELOW = 0.85
        const val LEFT_OPEN_AFTER_MS = 10L * 60_000L
        private val CONTACT_CLASSES = setOf("door", "window", "garage_door", "opening")
    }

    private fun toWatts(value: Double, unit: String?): Double = when (unit) {
        "kW" -> value * 1000.0
        "mW" -> value / 1000.0
        else -> value
    }
    private fun fmt(n: Double): String = kotlin.math.round(n).toLong().toString()

    private fun parseData(s: String?): JsonElement? = s?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() }

    fun list(c: Caller, includeCleared: Boolean = false): List<AlertView> {
        val rows = db.read { identityQueries.selectAlertsByHousehold(c.householdId, if (includeCleared) 1L else 0L).executeAsList() }
        return rows.mapNotNull { viewFor(c, it.id) }
    }

    fun viewFor(c: Caller, alertId: String): AlertView? {
        val a = db.read { identityQueries.selectAlertById(alertId).executeAsOneOrNull() } ?: return null
        if (a.household_id != c.householdId) return null
        val thing = runBlockingThingByRef(c.householdId, a.connection_id, a.thing_ref)
        var thingId: String? = null
        var name: String? = null
        if (thing != null) {
            val can = things.canSee(c, a.connection_id, thing.primary?.entityId ?: thing.entityIds.firstOrNull() ?: a.entity_id, thing)
            if (!can) return null
            thingId = thing.id; name = thing.name
        } else if (c.role.wire != "admin") return null
        return AlertView(a.id, a.kind, a.title, a.detail, thingId, name, parseData(a.data_), a.created_at, a.cleared_at, a.acked_at)
    }

    private fun runBlockingThingByRef(householdId: String, connectionId: String, ref: String): alice.ha.Thing? = try {
        runBlocking {
            things.things(householdId, includeHidden = true).firstOrNull { it.ref == ref || things.refMatches(it, ref) }
        }
    } catch (_: Throwable) { null }

    fun ack(c: Caller, alertId: String): AlertView {
        val v = viewFor(c, alertId) ?: throw notFound("Alert")
        db.write { identityQueries.ackAlert(c.userId, time.now(), alertId) }
        return viewFor(c, alertId) ?: v.copy(ackedAt = time.now())
    }

    private fun clear(alertId: String, householdId: String) {
        db.write { identityQueries.clearAlert(time.now(), alertId) }
        bus.publish(AlertCleared(householdId, time.now().toString(), alertId, mutableMapOf("id" to alertId)))
    }

    private fun limitFor(householdId: String, connectionId: String, entityIds: List<String>): Int? {
        for (id in entityIds) {
            val r = db.read { identityQueries.selectEntitySettings(householdId, connectionId, id).executeAsOneOrNull() }
            val l = r?.power_limit_w?.toInt()
            if (l != null && l > 0) return l
        }
        return null
    }

    private fun leftOpenThresholdMs(householdId: String, connectionId: String, entityIds: List<String>): Long {
        for (id in entityIds) {
            val r = db.read { identityQueries.selectEntitySettings(householdId, connectionId, id).executeAsOneOrNull() }
            val ms = r?.left_open_after_ms
            if (ms != null && ms > 0) return ms
        }
        return LEFT_OPEN_AFTER_MS
    }

    suspend fun evaluatePower(householdId: String, connectionId: String, entityId: String, rawState: String?, attributes: Map<String, Any?>) {
        val found = alice.core.concurrent.runCatchingNonCancellation { things.findEntity(householdId, entityId) }.getOrNull() ?: return
        val thing = found.thing
        val deviceClass = (attributes["device_class"] as? String) ?: (attributes["device_class"]?.toString())
        val unit = attributes["unit_of_measurement"] as? String
        val active = db.read { identityQueries.selectActiveAlertByThingKind(householdId, connectionId, thing.ref, "power_limit").executeAsOneOrNull() }
        val primaryId = thing.primary?.entityId
        val ids = (listOfNotNull(primaryId) + thing.entityIds).distinct()
        val limit = limitFor(householdId, connectionId, ids)
        if (limit == null) { if (active != null) clear(active.id, householdId); return }
        val wattsRaw = rawState?.toDoubleOrNull() ?: return
        if (deviceClass != "power") return
        val watts = toWatts(wattsRaw, unit)
        val ratio = watts / limit.toDouble()
        val data = buildJsonObject { put("watts", kotlin.math.round(watts).toInt()); put("limitW", limit); put("percent", kotlin.math.round(ratio * 100).toInt()) }
        if (active != null) {
            if (ratio < CLEAR_BELOW) clear(active.id, householdId)
            else db.write { identityQueries.updateAlertDataDetail(json.encodeToString(data), active.detail, active.id) }
            return
        }
        if (ratio < RAISE_AT) return
        val percent = kotlin.math.round(ratio * 100).toInt()
        val title = "${thing.name} is at $percent% of its ${fmt(limit.toDouble())} W limit"
        val detail = "${thing.name} is using ${fmt(watts)} W. You can raise its limit in the device's settings."
        val id = Ids.next("alr")
        val now = time.now()
        db.write { identityQueries.insertAlert(id, householdId, "power_limit", connectionId, entityId, thing.ref, title, detail, json.encodeToString(data), now, null, null, null) }
        bus.publish(AlertCreated(householdId, now.toString(), id, mutableMapOf("id" to id, "thingId" to thing.id, "title" to title, "detail" to detail)))
        notifications.notifyHousehold(householdId, NewNotification("power_limit", title, detail, data = buildJsonObject { put("alertId", id); put("thingId", thing.id) }))
        runCatching { activity.value?.record(householdId, "alert", null, connectionId, entityId, title, "warn", dedupeWithinMs = 60_000L) }
    }

    suspend fun clearLeftOpenFor(householdId: String, connectionId: String, entityId: String) {
        val found = alice.core.concurrent.runCatchingNonCancellation { things.findEntity(householdId, entityId) }.getOrNull() ?: return
        val thing = found.thing
        if (thing.primary?.entityId != entityId) return
        val active = db.read { identityQueries.selectAlertsByHousehold(householdId, 0L).executeAsList() }
            .filter { it.kind == "left_open" && it.connection_id == connectionId && it.thing_ref == thing.ref }
        active.forEach { clear(it.id, householdId) }
    }

    suspend fun evaluateLeftOpen(householdId: String, connectionId: String, entityId: String, rawState: String?, attributes: Map<String, Any?>, lastChangedIso: String?) {
        val found = alice.core.concurrent.runCatchingNonCancellation { things.findEntity(householdId, entityId) }.getOrNull() ?: return
        val thing = found.thing
        if (thing.primary?.entityId != entityId) return
        val domain = entityId.substringBefore('.')
        val deviceClass = attributes["device_class"]?.toString()
        val isContact = domain == "cover" || (domain == "binary_sensor" && deviceClass in CONTACT_CLASSES)
        if (!isContact) return
        val open = when (domain) {
            "cover" -> rawState != "closed"
            "binary_sensor" -> rawState == "on"
            else -> false
        }
        if (!open) { clearLeftOpenFor(householdId, connectionId, entityId); return }
        val since = parseMillis(lastChangedIso) ?: return
        val threshold = leftOpenThresholdMs(householdId, connectionId, (listOfNotNull(thing.primary?.entityId) + thing.entityIds).distinct())
        val now = time.now()
        if (now - since < threshold) return
        val minutes = ((now - since) / 60_000L).toInt().coerceAtLeast(1)
        val active = db.read { identityQueries.selectActiveAlertByThingKind(householdId, connectionId, thing.ref, "left_open").executeAsOneOrNull() }
        val detail = "Left open for $minutes minutes."
        val data = buildJsonObject { put("minutes", minutes); put("since", since) }
        if (active != null) {
            db.write { identityQueries.updateAlertDataDetail(json.encodeToString(data), detail, active.id) }
            return
        }
        val title = "${thing.name} is open"
        val id = Ids.next("alr")
        db.write { identityQueries.insertAlert(id, householdId, "left_open", connectionId, entityId, thing.ref, title, detail, json.encodeToString(data), now, null, null, null) }
        bus.publish(AlertCreated(householdId, now.toString(), id, mutableMapOf("id" to id, "thingId" to thing.id, "title" to title, "detail" to detail)))
        notifications.notifyHousehold(householdId, NewNotification("left_open", title, detail, data = buildJsonObject { put("alertId", id); put("thingId", thing.id) }))
        runCatching { activity.value?.record(householdId, "alert", null, connectionId, entityId, title, "warn", dedupeWithinMs = 60_000L) }
    }

    private fun parseMillis(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
    }

    suspend fun sweepLeftOpen(householdId: String) {
        val gw = gateway ?: return
        val states = alice.core.concurrent.runCatchingNonCancellation { gw.getStates() }.getOrNull() ?: return
        val byEntity = states.associateBy { it.entity_id }
        val thingsList = alice.core.concurrent.runCatchingNonCancellation { things.things(householdId, includeHidden = true) }.getOrNull() ?: return
        for (thing in thingsList) {
            val entityId = thing.primary?.entityId ?: continue
            val st = byEntity[entityId] ?: continue
            val attrs = st.attributes.mapValues { (_, v) -> (v as? kotlinx.serialization.json.JsonPrimitive)?.let { p ->
                p.content.toBooleanStrictOrNull() ?: p.content.toLongOrNull() ?: p.content.toDoubleOrNull() ?: p.content
            } ?: v.toString() }
            val domain = entityId.substringBefore('.')
            val deviceClass = attrs["device_class"]?.toString()
            val isContact = domain == "cover" || (domain == "binary_sensor" && deviceClass in CONTACT_CLASSES)
            if (!isContact) continue
            val open = when (domain) { "cover" -> st.state != "closed"; "binary_sensor" -> st.state == "on"; else -> false }
            if (!open) {
                clearLeftOpenFor(householdId, alice.ha.Connections.DEFAULT_ID, entityId)
            } else {
                evaluateLeftOpen(householdId, alice.ha.Connections.DEFAULT_ID, entityId, st.state, attrs, st.last_changed)
            }
        }
        // clear orphan active left_open alerts for non-open/missing primaries
        val active = db.read { identityQueries.selectAlertsByHousehold(householdId, 0L).executeAsList() }.filter { it.kind == "left_open" }
        for (a in active) {
            val thing = thingsList.firstOrNull { it.ref == a.thing_ref }
            val eid = thing?.primary?.entityId
            val st = eid?.let { byEntity[it] }
            if (thing == null || eid == null || st == null) { clear(a.id, householdId); continue }
            val domain = eid.substringBefore('.')
            val open = when (domain) { "cover" -> st.state != "closed"; "binary_sensor" -> st.state == "on"; else -> false }
            if (!open) clear(a.id, householdId)
        }
    }
}
