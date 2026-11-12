package alice.server.automations

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.ids.Ids
import alice.core.time.TimeProvider
import alice.ha.ConfigJobService
import alice.server.actions.ActionService
import alice.server.actions.ActionSpec
import alice.server.things.Caller as AccessCaller
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import alice.server.sync.HaCompile
import alice.core.concurrent.runCatchingNonCancellation
import kotlinx.coroutines.runBlocking

@Serializable data class HaAutomationView(val entityId: String? = null, val syncStatus: String, val syncError: String? = null)
@Serializable data class AutomationView(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val summary: String,
    val definition: JsonElement,
    val haAutomation: HaAutomationView,
    val sensitiveActions: List<String> = emptyList(),
    val lastTriggeredAt: Long? = null,
    val createdAt: Long,
    val updatedAt: Long,
)
@Serializable data class AutomationRunView(val id: String, val triggeredAt: Long, val source: String? = null)
@Serializable data class PreviewResult(val summary: String, val haConfig: JsonElement? = null, val warnings: List<String> = emptyList())

data class Caller(val householdId: String, val userId: String, val role: alice.server.households.Role, val steppedUp: Boolean) {
    fun toAccess() = AccessCaller(householdId, userId, role, steppedUp)
}

class AutomationsService(
    private val db: Database,
    private val time: TimeProvider,
    private val actions: ActionService,
    private val configJobs: ConfigJobService? = null,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true },
    private val activity: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
    private val presenceRef: Lazy<alice.server.presence.PresenceService?> = lazyOf(null),
    private val thingsRef: Lazy<alice.server.things.ThingsService?> = lazyOf(null),
    private val scenesRef: Lazy<alice.server.scenes.ScenesService?> = lazyOf(null),
    private val routinesRef: Lazy<alice.server.routines.RoutinesService?> = lazyOf(null),
    private val modesRef: Lazy<alice.server.modes.ModesService?> = lazyOf(null),
    private val notificationsRef: Lazy<alice.server.notifications.NotificationsService?> = lazyOf(null),
) {
    private val maxConditions = 10
    private val maxActions = 20
    private val entityRe = Regex("^[a-z_]+\\.[a-z0-9_]+$")
    private val modes = setOf("home", "away", "night", "vacation")

    private fun row(householdId: String, id: String): alice.core.db.Automations {
        val r = db.read { identityQueries.selectAutomationById(id).executeAsOneOrNull() } ?: throw notFound("Automation")
        if (r.household_id != householdId) throw notFound("Automation")
        return r
    }

    private fun configId(id: String) = HaCompile.automationConfigId(id)

    private fun parseDefinition(input: JsonElement): JsonObject {
        val obj = input as? JsonObject ?: throw validationError("The automation must be an object")
        val version = obj["version"]?.jsonPrimitive?.intOrNull ?: throw validationError("Unsupported automation version")
        if (version != 1) throw validationError("Unsupported automation version")
        val trigger = obj["trigger"] as? JsonObject ?: throw validationError("An automation needs a trigger")
        validateTrigger(trigger)
        val conds = (obj["conditions"] as? JsonArray ?: JsonArray(emptyList()))
        if (conds.size > maxConditions) throw validationError("At most $maxConditions conditions")
        conds.forEach { validateCondition(it as? JsonObject ?: throw validationError("Invalid condition")) }
        val acts = (obj["actions"] as? JsonArray) ?: throw validationError("An automation needs actions")
        if (acts.isEmpty() || acts.size > maxActions) throw validationError("An automation needs 1 to $maxActions actions")
        acts.forEach { validateActionShape(it as? JsonObject ?: throw validationError("Invalid action")) }
        return obj
    }

    private fun validateTrigger(t: JsonObject) {
        when (t["type"]?.jsonPrimitive?.contentOrNull) {
            "arrive" -> {
                val rawUser = t["userId"]
                if (rawUser != null) {
                    val user = rawUser as? JsonPrimitive ?: throw validationError("userId must be a person")
                    if (!user.isString || user.content.isBlank() || user.content.length > 100) throw validationError("userId must be a person")
                } else {
                    val p = t["person"]?.jsonPrimitive?.contentOrNull ?: throw validationError("person is required")
                    if (p != "anyone" && !entityRe.matches(p)) throw validationError("person is not an entity id")
                }
            }
            "leave" -> {}
            "time" -> {
                val at = t["at"]?.jsonPrimitive?.contentOrNull ?: throw validationError("Time must be HH:MM (24 hour)")
                if (!Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(at)) throw validationError("Time must be HH:MM (24 hour)")
            }
            "sunset", "sunrise" -> {
                val off = t["offsetMinutes"]?.jsonPrimitive?.intOrNull ?: 0
                if (kotlin.math.abs(off) > 360) throw validationError("Offset must be a whole number of minutes, at most 6 hours either way")
            }
            "door_opens", "motion", "power_over_limit" -> {
                val eid = t["entityId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("device is not an entity id")
                if (!entityRe.matches(eid)) throw validationError("device is not an entity id")
            }
            else -> throw validationError("Unknown trigger")
        }
    }

    private fun validateCondition(c: JsonObject) {
        when (c["type"]?.jsonPrimitive?.contentOrNull) {
            "dark", "someone_home" -> {}
            "days" -> {
                val d = c["days"]?.jsonPrimitive?.contentOrNull
                if (d != "weekdays" && d != "weekends") throw validationError("days must be weekdays or weekends")
            }
            "mode" -> { val m = c["mode"]?.jsonPrimitive?.contentOrNull; if (m !in modes) throw validationError("Unknown mode") }
            else -> throw validationError("Unknown condition")
        }
    }

    private fun validateActionShape(a: JsonObject) {
        when (a["type"]?.jsonPrimitive?.contentOrNull) {
            "device" -> {
                val eid = a["entityId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("device is not an entity id")
                if (!entityRe.matches(eid)) throw validationError("device is not an entity id")
                if (a["action"]?.jsonPrimitive?.contentOrNull.isNullOrBlank()) throw validationError("action is missing or too long")
            }
            "scene" -> { if (a["sceneId"]?.jsonPrimitive?.contentOrNull.isNullOrBlank()) throw validationError("scene is missing or too long") }
            "routine" -> { if (a["routineId"]?.jsonPrimitive?.contentOrNull.isNullOrBlank()) throw validationError("routine is missing or too long") }
            "mode" -> { val m = a["mode"]?.jsonPrimitive?.contentOrNull; if (m !in modes) throw validationError("Unknown mode") }
            "notify" -> { if (a["message"]?.jsonPrimitive?.contentOrNull.isNullOrBlank()) throw validationError("message is missing or too long") }
            else -> throw validationError("Unknown action")
        }
    }

    private fun isHouseholdMember(householdId: String, userId: String): Boolean =
        db.read { identityQueries.selectHouseholdMembersWithUsers(householdId).executeAsList() }.any { it.user_id == userId }

    private suspend fun checkActions(c: Caller, def: JsonObject) {
        val triggerUser = (def["trigger"] as? JsonObject)?.get("userId") as? JsonPrimitive
        if (triggerUser != null && (!triggerUser.isString || !isHouseholdMember(c.householdId, triggerUser.content))) {
            throw validationError("That person is not in this home")
        }
        val acts = def["actions"]?.jsonArray ?: return
        for (a in acts) {
            val obj = a as? JsonObject ?: continue
            when (obj["type"]?.jsonPrimitive?.contentOrNull) {
                "device" -> {
                    val eid = obj["entityId"]!!.jsonPrimitive.content
                    val action = obj["action"]!!.jsonPrimitive.content
                    val params = (obj["parameters"] as? JsonObject)?.mapValues { it.value } ?: emptyMap()
                    actions.validate(c.toAccess(), ActionSpec(eid, action, params))
                }
                "notify" -> {
                    val named = (obj["userIds"] as? JsonArray)?.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: throw validationError("userIds must be a list of user ids") }.orEmpty()
                    val members = notificationsRef.value?.recipients(c.householdId)?.toSet()
                    if (members != null && named.any { it !in members }) throw validationError("A notification can only go to people in this home")
                }
                "scene" -> {
                    val sceneId = obj["sceneId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("scene is missing or too long")
                    val scene = db.read { identityQueries.selectSceneById(sceneId).executeAsOneOrNull() }
                    if (scene == null || scene.household_id != c.householdId) throw validationError("That scene is not in this home")
                }
                "routine" -> {
                    val routineId = obj["routineId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("routine is missing or too long")
                    val routine = db.read { identityQueries.selectRoutineById(routineId).executeAsOneOrNull() }
                    if (routine == null || routine.household_id != c.householdId) throw validationError("That routine is not in this home")
                }
            }
        }
    }

    private fun describe(def: JsonObject): String {
        val trigger = def["trigger"] as? JsonObject
        val t = trigger?.get("type")?.jsonPrimitive?.contentOrNull ?: "something happens"
        val whenText = when (t) {
            "arrive" -> if (trigger?.get("userId") != null) "a household member gets home" else if (trigger?.get("person")?.jsonPrimitive?.contentOrNull == "anyone") "someone gets home" else "someone gets home"
            "leave" -> "everyone has left"
            "time" -> "it is ${trigger?.get("at")?.jsonPrimitive?.contentOrNull ?: "a set time"}"
            "sunset" -> "the sun sets"
            "sunrise" -> "the sun rises"
            "door_opens" -> "${trigger?.get("entityId")?.jsonPrimitive?.contentOrNull ?: "a door"} opens"
            "motion" -> "motion is seen at ${trigger?.get("entityId")?.jsonPrimitive?.contentOrNull ?: "a sensor"}"
            "power_over_limit" -> "${trigger?.get("entityId")?.jsonPrimitive?.contentOrNull ?: "a device"} goes over its power limit"
            else -> "the trigger happens"
        }
        val acts = def["actions"]?.jsonArray ?: JsonArray(emptyList())
        val actionText = acts.joinToString(", ") { el ->
            val a = el as? JsonObject ?: return@joinToString "do something"
            when (a["type"]?.jsonPrimitive?.contentOrNull) {
                "device" -> "${a["action"]?.jsonPrimitive?.contentOrNull?.replace('_', ' ') ?: "control"} ${a["entityId"]?.jsonPrimitive?.contentOrNull ?: "a device"}"
                "scene" -> "run a scene"
                "routine" -> "run a routine"
                "mode" -> "switch to ${a["mode"]?.jsonPrimitive?.contentOrNull ?: "a"} mode"
                "notify" -> "send a notification"
                else -> "do something"
            }
        }.ifBlank { "do something" }
        return "When $whenText, $actionText."
    }

    private suspend fun sensitiveActions(householdId: String, def: JsonObject): List<String> {
        // Uses the household's sensitive-operation rules, the same ones the command path enforces.
        val out = mutableListOf<String>()
        val acts = def["actions"]?.jsonArray ?: return out
        for (a in acts) {
            val obj = a as? JsonObject ?: continue
            if (obj["type"]?.jsonPrimitive?.contentOrNull == "device") {
                val action = obj["action"]?.jsonPrimitive?.contentOrNull ?: continue
                val entityId = obj["entityId"]?.jsonPrimitive?.contentOrNull ?: continue
                if (actions.isSensitive(householdId, entityId, action)) out += "$action $entityId"
            }
        }
        return out
    }

    private fun view(r: alice.core.db.Automations, summary: String, sensitive: List<String>): AutomationView = AutomationView(
        id = r.id,
        name = r.name,
        enabled = r.enabled != 0L,
        summary = summary,
        definition = runCatching { json.parseToJsonElement(r.definition) }.getOrDefault(JsonObject(emptyMap())),
        haAutomation = HaAutomationView(r.ha_entity_id, r.sync_status, r.sync_error),
        sensitiveActions = sensitive,
        lastTriggeredAt = r.last_triggered_at,
        createdAt = r.created_at,
        updatedAt = r.updated_at,
    )

    suspend fun list(c: Caller): List<AutomationView> {
        val rows = db.read { identityQueries.selectAutomationsByHousehold(c.householdId).executeAsList() }
        return rows.map { r ->
            val def = runCatching { json.parseToJsonElement(r.definition).jsonObject }.getOrDefault(JsonObject(emptyMap()))
            view(r, describe(def), sensitiveActions(c.householdId, def))
        }
    }

    suspend fun get(c: Caller, id: String): AutomationView {
        val r = row(c.householdId, id)
        val def = runCatching { json.parseToJsonElement(r.definition).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        return view(r, describe(def), sensitiveActions(c.householdId, def))
    }


    private fun compileContext(householdId: String): HaCompile.AutomationCompileContext {
        val presence = presenceRef.value
        val things = thingsRef.value
        val personEntityIds = db.read { identityQueries.selectPersonLinksByHousehold(householdId).executeAsList() }
            .map { it.person_entity_id }.distinct()
        val personOfUser: (String) -> String? = { userId ->
            presence?.personOf(householdId, userId)
                ?: db.read { identityQueries.selectPersonLinkByUser(householdId, userId).executeAsOneOrNull()?.person_entity_id }
        }
        val powerLimit: (String) -> Pair<String, Int>? = { entityId ->
            val found = things?.let { alice.core.concurrent.runCatchingNonCancellation { runBlocking { it.findEntity(householdId, entityId) } }.getOrNull() }
            val connId = found?.connectionId ?: db.read { identityQueries.selectHaConnectionByHousehold(householdId).executeAsOneOrNull()?.id } ?: alice.ha.Connections.DEFAULT_ID
            val candidateEntityIds = mutableListOf(entityId)
            if (found != null) {
                val t = found.thing
                val all = listOfNotNull(t.primary) + t.others + t.controls + t.sensors + t.facets + t.diagnostics
                candidateEntityIds += all.map { it.entityId }
                val sensor = all.firstOrNull { e ->
                    e.domain == "sensor" && (e.deviceClass == "power" || e.entityId.contains("power"))
                }?.entityId
                if (sensor != null) {
                    val limit = candidateEntityIds.firstNotNullOfOrNull { eid ->
                        db.read { identityQueries.selectEntitySettings(householdId, connId, eid).executeAsOneOrNull()?.power_limit_w?.toInt() }
                    }
                    if (limit != null) sensor to limit else null
                } else null
            } else null
        }
        return HaCompile.AutomationCompileContext(personEntityIds, personOfUser, powerLimit)
    }

    private fun tryCompile(name: String, def: JsonObject, householdId: String): JsonObject =
        HaCompile.compileAutomation(name, def, compileContext(householdId))


    private fun syncRow(householdId: String, userId: String?, r: alice.core.db.Automations, def: JsonObject, enabled: Boolean, now: Long) {
        val jobs = configJobs
        val cid = configId(r.id)
        if (jobs == null) {
            db.write { identityQueries.updateAutomation(r.name, json.encodeToString(def), if (enabled) 1L else 0L, "not_synced", "Home Assistant sync not configured", null, r.ha_entity_id, r.compiled_hash, r.last_triggered_at, now, r.id) }
            return
        }
        val st = jobs.status(householdId)
        if (!st.connected || !st.adminTokenSet) {
            val reason = if (!st.connected) "Home Assistant is not connected" else "Add a Home Assistant admin token so this can also run from Home Assistant"
            db.write { identityQueries.updateAutomation(r.name, json.encodeToString(def), if (enabled) 1L else 0L, "not_synced", reason, null, r.ha_entity_id, r.compiled_hash, r.last_triggered_at, now, r.id) }
            return
        }
        val payload = try {
            val haConfig = tryCompile(r.name, def, householdId)
            json.encodeToString(kotlinx.serialization.json.buildJsonObject {
                put("id", JsonPrimitive(cid))
                put("enabled", JsonPrimitive(enabled))
                put("config", haConfig)
            })
        } catch (e: Exception) {
            db.write { identityQueries.updateAutomation(r.name, json.encodeToString(def), if (enabled) 1L else 0L, "failed", e.message ?: "Automation cannot be compiled for Home Assistant sync", null, r.ha_entity_id, r.compiled_hash, r.last_triggered_at, now, r.id) }
            return
        }
        jobs.enqueue(householdId, "automation.upsert", payload, "automation:$cid", userId)
        db.write { identityQueries.updateAutomation(r.name, json.encodeToString(def), if (enabled) 1L else 0L, "pending", null, null, "automation.$cid", r.compiled_hash, r.last_triggered_at, now, r.id) }
    }

    suspend fun preview(c: Caller, name: String, input: JsonElement): PreviewResult {
        val def = parseDefinition(input)
        checkActions(c, def)
        val warnings = mutableListOf<String>()
        val st = configJobs?.status(c.householdId)
        if (st == null) warnings += "Home Assistant sync is not configured"
        else if (!st.connected) warnings += "Home Assistant is not connected"
        else if (!st.adminTokenSet) warnings += "Add a Home Assistant admin token so Home Assistant can run this automation"
        val haConfig = runCatching { tryCompile(name, def, c.householdId) }.onFailure {
            warnings += (it.message ?: "Automation cannot be compiled for Home Assistant sync")
        }.getOrNull()
        if (haConfig == null && warnings.none { it.contains("compiled", true) }) warnings += "Automation could not be compiled for Home Assistant sync in this runtime"
        return PreviewResult(summary = describe(def), haConfig = haConfig, warnings = warnings)
    }

    suspend fun create(c: Caller, name: String, enabled: Boolean?, definition: JsonElement): AutomationView {
        val n = name.trim().also { if (it.length !in 1..80) throw validationError("Name must be 1 to 80 characters") }
        val def = parseDefinition(definition)
        checkActions(c, def)
        val t = time.now()
        val id = Ids.next("atm")
        val en = enabled ?: true
        db.write {
            identityQueries.insertAutomation(id, c.householdId, n, json.encodeToString(def), if (en) 1L else 0L, "not_synced", null, null, null, null, null, c.userId, t, t)
        }
        val r = row(c.householdId, id)
        syncRow(c.householdId, c.userId, r, def, en, t)
        return get(c, id)
    }

    suspend fun update(c: Caller, id: String, name: String?, enabled: Boolean?, definition: JsonElement?): AutomationView {
        val r = row(c.householdId, id)
        val n = name?.trim()?.also { if (it.length !in 1..80) throw validationError("Name must be 1 to 80 characters") } ?: r.name
        val def = if (definition != null) parseDefinition(definition).also { checkActions(c, it) } else runCatching { json.parseToJsonElement(r.definition).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        val en = enabled ?: (r.enabled != 0L)
        val t = time.now()
        db.write { identityQueries.updateAutomation(n, json.encodeToString(def), if (en) 1L else 0L, "pending", null, null, r.ha_entity_id, r.compiled_hash, r.last_triggered_at, t, r.id) }
        val updated = row(c.householdId, id)
        syncRow(c.householdId, c.userId, updated, def, en, t)
        return get(c, id)
    }

    suspend fun setEnabled(c: Caller, id: String, enabled: Boolean): AutomationView = update(c, id, null, enabled, null)

    fun remove(c: Caller, id: String) {
        val r = row(c.householdId, id)
        val cid = configId(id)
        if (configJobs != null) {
            val st = configJobs.status(c.householdId)
            if (st.connected && st.adminTokenSet) configJobs.enqueue(c.householdId, "automation.delete", json.encodeToString(kotlinx.serialization.json.buildJsonObject { put("id", JsonPrimitive(cid)) }), "automation:$cid", c.userId)
        }
        db.write { identityQueries.deleteAutomation(id) }
    }

    fun reconcile(c: Caller): Int {
        val rows = db.read { identityQueries.selectAutomationsByHousehold(c.householdId).executeAsList() }
            .filter { it.sync_status in setOf("not_synced", "failed", "drifted") }
        val now = time.now()
        for (r in rows) {
            val def = runCatching { json.parseToJsonElement(r.definition).jsonObject }.getOrDefault(kotlinx.serialization.json.JsonObject(emptyMap()))
            syncRow(c.householdId, c.userId, r, def, r.enabled != 0L, now)
        }
        return rows.size
    }

    fun driftedCount(householdId: String): Int =
        db.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }.count { it.sync_status == "drifted" }

    fun verificationAutomations(householdId: String): List<Triple<String, kotlinx.serialization.json.JsonObject, Boolean>> {
        return db.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }
            .filter { it.sync_status in setOf("synced", "drifted") }
            .mapNotNull { r ->
                runCatching {
                    val def = json.parseToJsonElement(r.definition).jsonObject
                    Triple(configId(r.id), tryCompile(r.name, def, householdId), r.enabled != 0L)
                }.getOrNull()
            }
    }



    private suspend fun runOne(c: Caller, obj: JsonObject): Boolean = when (obj["type"]?.jsonPrimitive?.contentOrNull) {
        "device" -> {
            val eid = obj["entityId"]!!.jsonPrimitive.content
            val action = obj["action"]!!.jsonPrimitive.content
            val params = (obj["parameters"] as? JsonObject)?.mapValues { it.value } ?: emptyMap()
            actions.run(c.toAccess(), listOf(ActionSpec(eid, action, params)))
            true
        }
        "scene" -> {
            val sceneId = obj["sceneId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("scene is missing or too long")
            val scenes = scenesRef.value ?: return false
            scenes.activate(c.toAccess(), sceneId)
            true
        }
        "routine" -> {
            val routineId = obj["routineId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("routine is missing or too long")
            val routines = routinesRef.value ?: return false
            routines.execute(alice.server.routines.Caller(c.householdId, c.userId, c.role, c.steppedUp), routineId)
            true
        }
        "mode" -> {
            val mode = obj["mode"]?.jsonPrimitive?.contentOrNull ?: throw validationError("Unknown mode")
            val modes = modesRef.value ?: return false
            modes.set(c.householdId, c.userId, mode)
            true
        }
        "notify" -> {
            val notif = notificationsRef.value ?: return false
            val title = obj["title"]?.jsonPrimitive?.contentOrNull ?: "Home"
            val message = obj["message"]?.jsonPrimitive?.contentOrNull ?: ""
            val ids = (obj["userIds"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            val n = alice.server.notifications.NewNotification("automation", title, message)
            if (ids.isNullOrEmpty()) notif.notifyHousehold(c.householdId, n) else notif.notifyUsers(c.householdId, ids, n)
            true
        }
        else -> throw validationError("Unknown action")
    }

    suspend fun runNow(c: Caller, id: String): JsonObject {
        val r = row(c.householdId, id)
        val def = runCatching { json.parseToJsonElement(r.definition).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        checkActions(c, def)
        val sensitive = sensitiveActions(c.householdId, def)
        if (sensitive.isNotEmpty() && !c.steppedUp) {
            throw AppException(ErrorCode.FORBIDDEN, "This automation does something sensitive and needs a fresh passkey confirmation", 403)
        }
        val acts = def["actions"]?.jsonArray ?: JsonArray(emptyList())
        var executed = 0
        var skipped = 0
        val failed = mutableListOf<JsonObject>()
        for ((index, a) in acts.withIndex()) {
            val obj = a as? JsonObject ?: continue
            val type = obj["type"]?.jsonPrimitive?.contentOrNull ?: "unknown"
            val outcome = runCatchingNonCancellation { runOne(c, obj) }
            if (outcome.isSuccess) {
                if (outcome.getOrThrow()) executed++ else skipped++
            } else {
                val e = outcome.exceptionOrNull()!!
                failed += buildJsonObject {
                    put("index", JsonPrimitive(index))
                    put("type", JsonPrimitive(type))
                    put("error", JsonPrimitive((e.message ?: e.toString()).take(300)))
                }
                if (type == "device" && e is AppException && (e.status == 403 || e.status == 404)) break
            }
        }
        recordRun(c.householdId, id, "manual")
        runCatching {
            val suffix = if (failed.isEmpty()) "" else " with ${failed.size} failed action(s)"
            activity.value
                ?.record(c.householdId, "automation", c.userId, null, null, "The “${r.name}” automation ran$suffix")
        }
        return buildJsonObject {
            put("ok", JsonPrimitive(failed.isEmpty()))
            put("executed", JsonPrimitive(executed))
            put("skipped", JsonPrimitive(skipped))
            put("failed", buildJsonArray { failed.forEach { add(it) } })
        }
    }



    fun runs(c: Caller, id: String, limit: Int = 50): List<AutomationRunView> {
        row(c.householdId, id)
        return db.read { identityQueries.selectAutomationRunsByAutomation(id, limit.coerceAtMost(200).toLong()).executeAsList() }
            .map { AutomationRunView(it.id, it.triggered_at, it.source) }
    }

    fun recordRun(householdId: String, automationId: String, source: String? = null) {
        val r = db.read { identityQueries.selectAutomationById(automationId).executeAsOneOrNull() } ?: return
        if (r.household_id != householdId) return
        val t = time.now()
        db.write {
            identityQueries.insertAutomationRun(Ids.next("arn"), automationId, householdId, t, source)
            identityQueries.updateAutomation(r.name, r.definition, r.enabled, r.sync_status, r.sync_error, r.synced_at, r.ha_entity_id, r.compiled_hash, t, t, r.id)
        }
    }
}
