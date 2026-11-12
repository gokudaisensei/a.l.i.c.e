package alice.server.scenes

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.time.TimeProvider
import alice.server.actions.ActionService
import alice.server.actions.ActionSpec
import alice.server.actions.SkippedAction
import alice.server.commands.DeviceCommand
import alice.server.things.Caller
import alice.server.sync.HaCompile
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject

const val MAX_SCENE_ACTIONS = 50

@Serializable
data class HaScriptView(val status: String, val error: String? = null, val syncedAt: Long? = null, val entityId: String? = null)

@Serializable
data class SceneView(
    val id: String,
    val name: String,
    val icon: String? = null,
    val description: String? = null,
    val lastRunAt: Long? = null,
    val actions: List<ActionSpec>? = null,
    val haScript: HaScriptView? = null,
)

class ScenesService(
    private val db: Database,
    private val actions: ActionService,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
    private val configJobs: alice.ha.ConfigJobService? = null,
    private val activity: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
) {
    private fun row(c: Caller, id: String): alice.core.db.Scenes {
        val s = db.read { identityQueries.selectSceneById(id).executeAsOneOrNull() }
        if (s == null || s.household_id != c.householdId) throw notFound("Scene")
        return s
    }



    private fun objectId(id: String) = HaCompile.sceneObjectId(id)
    private fun scriptEntityId(id: String) = "script.${objectId(id)}"

    private fun syncSceneRow(householdId: String, userId: String?, s: alice.core.db.Scenes, actions: List<ActionSpec>, now: Long) {
        val jobs = configJobs
        if (jobs == null) {
            db.write { identityQueries.updateScene(s.name, s.icon, s.description, json.encodeToString(actions), now, s.last_run_at, "not_synced", "Home Assistant sync not configured", null, s.ha_entity_id, s.id) }
            return
        }
        val status = jobs.status(householdId)
        if (!status.connected || !status.adminTokenSet) {
            val reason = if (!status.connected) "Home Assistant is not connected" else "Add a Home Assistant admin token so this can also run from Home Assistant"
            db.write { identityQueries.updateScene(s.name, s.icon, s.description, json.encodeToString(actions), now, s.last_run_at, "not_synced", reason, null, s.ha_entity_id, s.id) }
            return
        }
        val payload = json.encodeToString(kotlinx.serialization.json.buildJsonObject {
            put("objectId", kotlinx.serialization.json.JsonPrimitive(objectId(s.id)))
            put("config", HaCompile.compileScene(s.name, s.description, s.icon, actions))
        })
        jobs.enqueue(householdId, "script.upsert", payload, "script:${objectId(s.id)}", userId)
        db.write { identityQueries.updateScene(s.name, s.icon, s.description, json.encodeToString(actions), now, s.last_run_at, "pending", null, null, scriptEntityId(s.id), s.id) }
    }

    private fun actionsOf(s: alice.core.db.Scenes): List<ActionSpec> =
        runCatching { json.decodeFromString<List<ActionSpec>>(s.actions) }.getOrDefault(emptyList())

    private suspend fun visibleToGuest(c: Caller, acts: List<ActionSpec>): Boolean = actions.touchesVisible(c, acts)

    private suspend fun view(c: Caller, s: alice.core.db.Scenes): SceneView {
        val acts = actionsOf(s)
        val guest = c.role == alice.server.households.Role.GUEST
        return SceneView(
            id = s.id,
            name = s.name,
            icon = s.icon,
            description = s.description,
            lastRunAt = s.last_run_at,
            actions = if (guest) null else acts,
            haScript = if (guest) null else HaScriptView(s.sync_status, s.sync_error, s.synced_at, s.ha_entity_id),
        )
    }

    suspend fun list(c: Caller): List<SceneView> {
        val rows = db.read { identityQueries.selectScenesByHousehold(c.householdId).executeAsList() }
        val out = mutableListOf<SceneView>()
        for (s in rows) {
            val acts = actionsOf(s)
            if (c.role == alice.server.households.Role.GUEST && !visibleToGuest(c, acts)) continue
            out.add(view(c, s))
        }
        return out
    }

    suspend fun get(c: Caller, id: String): SceneView {
        val s = row(c, id)
        val acts = actionsOf(s)
        if (c.role == alice.server.households.Role.GUEST && !visibleToGuest(c, acts)) throw notFound("Scene")
        return view(c, s)
    }

    private suspend fun clean(c: Caller, name: String?, actionsIn: List<ActionSpec>?): Pair<String?, List<ActionSpec>?> {
        var n: String? = null
        if (name != null) {
            val t = name.trim()
            if (t.length < 1 || t.length > 60) throw validationError("Name must be 1 to 60 characters")
            n = t
        }
        var a: List<ActionSpec>? = null
        if (actionsIn != null) {
            if (actionsIn.isEmpty()) throw validationError("A scene needs at least one action")
            if (actionsIn.size > MAX_SCENE_ACTIONS) throw validationError("At most $MAX_SCENE_ACTIONS actions per scene")
            for (act in actionsIn) actions.validate(c, act)
            a = actionsIn.map { ActionSpec(it.entityId, it.action, it.parameters) }
        }
        return n to a
    }

    suspend fun create(c: Caller, name: String, icon: String?, description: String?, actionsIn: List<ActionSpec>): SceneView {
        val (n, a) = clean(c, name, actionsIn)
        val id = Ids.next("scn")
        val now = time.now()
        db.write {
            identityQueries.insertScene(id, c.householdId, n!!, icon, description, json.encodeToString(a!!), c.userId, now, now)
            Audit.write(this, action = "scenes.created", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
        }
        val created = db.read { identityQueries.selectSceneById(id).executeAsOne() }
        syncSceneRow(c.householdId, c.userId, created, a!!, now)
        return get(c, id)
    }

    suspend fun update(c: Caller, id: String, name: String?, iconProvided: Boolean, icon: String?, descriptionProvided: Boolean, description: String?, actionsIn: List<ActionSpec>?): SceneView {
        val s = row(c, id)
        val acts = actionsOf(s)
        if (c.role == alice.server.households.Role.GUEST && !visibleToGuest(c, acts)) throw notFound("Scene")
        val (n, a) = clean(c, name, actionsIn)
        val now = time.now()
        val finalActs = a ?: acts
        db.write {
            identityQueries.updateScene(
                name = n ?: s.name,
                icon = if (iconProvided) icon else s.icon,
                description = if (descriptionProvided) description else s.description,
                actions = json.encodeToString(finalActs),
                updated_at = now,
                last_run_at = s.last_run_at,
                sync_status = s.sync_status,
                sync_error = s.sync_error,
                synced_at = s.synced_at,
                ha_entity_id = s.ha_entity_id,
                id = id,
            )
            Audit.write(this, action = "scenes.updated", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
        }
        val updated = db.read { identityQueries.selectSceneById(id).executeAsOne() }
        syncSceneRow(c.householdId, c.userId, updated, finalActs, now)
        return get(c, id)
    }

    fun remove(c: Caller, id: String) {
        val s = row(c, id)
        val jobs = configJobs
        if (jobs != null) {
            val st = jobs.status(c.householdId)
            if (st.connected && st.adminTokenSet) {
                jobs.enqueue(c.householdId, "script.delete", json.encodeToString(kotlinx.serialization.json.buildJsonObject { put("objectId", kotlinx.serialization.json.JsonPrimitive(objectId(id))) }), "script:${objectId(id)}", c.userId)
            }
        }
        db.write {
            identityQueries.deleteScene(id)
            Audit.write(this, action = "scenes.deleted", householdId = c.householdId, actorId = c.userId, resource = id, now = time.now())
        }
    }

    suspend fun reconcile(c: Caller): Int {
        val rows = db.read { identityQueries.selectScenesByHousehold(c.householdId).executeAsList() }
            .filter { it.sync_status in setOf("not_synced", "failed", "drifted") }
        for (s in rows) syncSceneRow(c.householdId, c.userId, s, actionsOf(s), time.now())
        return rows.size
    }

    fun driftedCount(householdId: String): Int =
        db.read { identityQueries.selectScenesByHousehold(householdId).executeAsList() }.count { it.sync_status == "drifted" }

    fun verificationScripts(householdId: String): List<Pair<String, kotlinx.serialization.json.JsonObject>> {
        return db.read { identityQueries.selectScenesByHousehold(householdId).executeAsList() }
            .filter { it.sync_status in setOf("synced", "drifted") }
            .mapNotNull { s ->
                val acts = actionsOf(s)
                val cfg = HaCompile.compileScene(s.name, s.description, s.icon, acts)
                objectId(s.id) to cfg
            }
    }


    suspend fun activate(c: Caller, id: String): Pair<List<DeviceCommand>, List<SkippedAction>> {
        val s = row(c, id)
        val acts = actionsOf(s)
        if (c.role == alice.server.households.Role.GUEST && !actions.touchesVisible(c, acts)) throw notFound("Scene")
        val result = actions.run(c, acts)
        val now = time.now()
        db.write {
            identityQueries.updateScene(s.name, s.icon, s.description, json.encodeToString(acts), s.updated_at, now, s.sync_status, s.sync_error, s.synced_at, s.ha_entity_id, id)
            Audit.write(this, action = "scenes.activated", householdId = c.householdId, actorId = c.userId, resource = id, now = now)
        }
        runCatching {
            activity.value
                ?.record(c.householdId, "scene", c.userId, null, null, "ran the “${s.name}” scene")
        }
        return result
    }
}
