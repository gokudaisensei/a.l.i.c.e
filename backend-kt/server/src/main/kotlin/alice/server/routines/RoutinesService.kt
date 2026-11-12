package alice.server.routines

import alice.core.db.Database
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.notFound
import alice.core.error.validationError
import alice.core.events.AppEvent
import alice.core.events.EventBus
import alice.core.ids.Ids
import alice.core.time.TimeProvider
import alice.server.actions.ActionService
import alice.server.actions.ActionSpec
import alice.server.households.HouseholdService
import alice.server.modes.HOUSEHOLD_MODES
import alice.server.modes.ModesService
import alice.server.permissions.Permission
import alice.server.permissions.can
import alice.server.scenes.ScenesService
import alice.server.things.Caller as AccessCaller
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap
import alice.server.sync.HaCompile

const val MAX_ROUTINE_STEPS = 50
const val MAX_DELAY_S = 3600
private const val STEP_UP_WINDOW_MS = 5 * 60_000L
private const val RUN_RETENTION_MS = 30L * 24 * 3_600_000

@Serializable data class HaScriptView(val entityId: String, val syncStatus: String, val syncError: String? = null)
@Serializable data class RoutineView(val id: String, val name: String, val icon: String? = null, val steps: JsonArray, val onFailure: String, val lastRunAt: Long? = null, val haScript: HaScriptView)
@Serializable data class StepResult(val index: Int, val type: String, val state: String, val detail: String? = null, val commandIds: List<String>? = null, val def: JsonElement)
@Serializable data class RoutineRunView(val id: String, val routineId: String, val routineName: String, val householdId: String, val userId: String, val state: String, val startedAt: Long, val finishedAt: Long? = null, val steps: List<StepResult>)

data class Caller(val householdId: String, val userId: String, val role: alice.server.households.Role, val steppedUp: Boolean)

private fun Caller.toAccess() = AccessCaller(householdId, userId, role, steppedUp)

private data class Live(val job: Job, @Volatile var cancelled: Boolean = false)

data class RoutineRunEvent(
    override val householdId: String,
    override val timestamp: String,
    val userId: String,
    val routineId: String,
    val routineName: String,
    val state: String,
) : AppEvent { override val type: String = "routine.finished" }

class RoutinesService(
    private val db: Database,
    private val actions: ActionService,
    private val scenes: ScenesService,
    private val modes: ModesService,
    private val households: HouseholdService,
    private val time: TimeProvider,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true },
    private val events: EventBus? = null,
    private val activity: Lazy<alice.server.activity.ActivityService?> = lazyOf(null),
    private val configJobs: alice.ha.ConfigJobService? = null,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val live = ConcurrentHashMap<String, Live>()

    private fun haScript(rowId: String, syncStatus: String, syncError: String?): HaScriptView {
        val objectId = "alice_routine_" + rowId.removePrefix("rtn_").replace("-", "_")
        return HaScriptView("script.$objectId", syncStatus, syncError)
    }

    private fun parseStepsArray(raw: String): JsonArray = runCatching {
        val el = json.parseToJsonElement(raw)
        if (el is JsonArray) el else JsonArray(emptyList())
    }.getOrDefault(JsonArray(emptyList()))

    private fun view(r: alice.core.db.Routines): RoutineView = RoutineView(
        id = r.id,
        name = r.name,
        icon = r.icon,
        steps = parseStepsArray(r.steps),
        onFailure = r.on_failure,
        lastRunAt = r.last_run_at,
        haScript = haScript(r.id, r.sync_status, r.sync_error),
    )

    private fun row(householdId: String, id: String): alice.core.db.Routines {
        val r = db.read { identityQueries.selectRoutineById(id).executeAsOneOrNull() } ?: throw notFound("Routine")
        if (r.household_id != householdId) throw notFound("Routine")
        return r
    }

    fun list(householdId: String): List<RoutineView> = db.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }.map(::view)
    fun get(householdId: String, id: String): RoutineView = view(row(householdId, id))

    private fun cleanName(name: String): String {
        val n = name.trim()
        if (n.length !in 1..60) throw validationError("Name must be 1 to 60 characters")
        return n
    }

    private suspend fun cleanSteps(c: Caller, steps: List<JsonElement>): List<JsonElement> {
        if (steps.isEmpty()) throw validationError("A routine needs at least one step")
        if (steps.size > MAX_ROUTINE_STEPS) throw validationError("At most $MAX_ROUTINE_STEPS steps per routine")
        return steps.map { el ->
            val obj = (el as? JsonObject) ?: throw validationError("Invalid step")
            when (obj["type"]?.jsonPrimitive?.contentOrNull) {
                "device" -> {
                    val entityId = obj["entityId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("entityId is required")
                    val action = obj["action"]?.jsonPrimitive?.contentOrNull ?: throw validationError("action is required")
                    val params = (obj["parameters"] as? JsonObject)?.mapValues { it.value } ?: emptyMap()
                    actions.validate(c.toAccess(), ActionSpec(entityId, action, params))
                    buildJsonObject {
                        put("type", JsonPrimitive("device"))
                        put("entityId", JsonPrimitive(entityId))
                        put("action", JsonPrimitive(action))
                        if (params.isNotEmpty()) put("parameters", JsonObject(params))
                    }
                }
                "scene" -> {
                    val sceneId = obj["sceneId"]?.jsonPrimitive?.contentOrNull ?: throw validationError("sceneId is required")
                    scenes.get(c.toAccess(), sceneId)
                    buildJsonObject { put("type", JsonPrimitive("scene")); put("sceneId", JsonPrimitive(sceneId)) }
                }
                "mode" -> {
                    val mode = obj["mode"]?.jsonPrimitive?.contentOrNull ?: throw validationError("mode is required")
                    if (mode !in HOUSEHOLD_MODES) throw validationError("Unknown mode")
                    buildJsonObject { put("type", JsonPrimitive("mode")); put("mode", JsonPrimitive(mode)) }
                }
                "delay" -> {
                    val seconds = obj["seconds"]?.jsonPrimitive?.intOrNull ?: obj["seconds"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: throw validationError("seconds is required")
                    if (seconds < 1 || seconds > MAX_DELAY_S) throw validationError("A wait must be 1 to $MAX_DELAY_S seconds")
                    buildJsonObject { put("type", JsonPrimitive("delay")); put("seconds", JsonPrimitive(seconds)) }
                }
                else -> throw validationError("Unknown step type")
            }
        }
    }

    suspend fun cleanStepsJson(c: Caller, steps: List<JsonElement>): String = json.encodeToString(cleanSteps(c, steps))

    suspend fun create(c: Caller, name: String, icon: String?, steps: List<JsonElement>, onFailure: String?): RoutineView {
        val n = cleanName(name)
        val clean = cleanSteps(c, steps)
        val of = if (onFailure == "continue") "continue" else "stop"
        val t = time.now()
        val id = Ids.next("rtn")
        val stepsJson = json.encodeToString(clean)
        db.write { identityQueries.insertRoutine(id, c.householdId, n, icon, stepsJson, of, c.userId, t, t, null, "not_synced", null, null, null) }
        val created = db.read { identityQueries.selectRoutineById(id).executeAsOne() }
        syncRoutineRow(c.householdId, c.userId, created, stepsJson, t)
        return get(c.householdId, id)
    }

    private fun objectId(id: String) = HaCompile.routineObjectId(id)
    private fun scriptEntityId(id: String) = "script.${objectId(id)}"

    private fun syncRoutineRow(householdId: String, userId: String?, r: alice.core.db.Routines, stepsJson: String, now: Long) {
        val jobs = configJobs
        if (jobs == null) {
            db.write { identityQueries.updateRoutine(r.name, r.icon, stepsJson, r.on_failure, now, r.last_run_at, "not_synced", "Home Assistant sync not configured", null, r.ha_entity_id, r.id) }
            return
        }
        val st = jobs.status(householdId)
        if (!st.connected || !st.adminTokenSet) {
            val reason = if (!st.connected) "Home Assistant is not connected" else "Add a Home Assistant admin token so this can also run from Home Assistant"
            db.write { identityQueries.updateRoutine(r.name, r.icon, stepsJson, r.on_failure, now, r.last_run_at, "not_synced", reason, null, r.ha_entity_id, r.id) }
            return
        }
        val stepsArr = parseStepsArray(stepsJson)
        val payload = json.encodeToString(buildJsonObject {
            put("objectId", JsonPrimitive(objectId(r.id)))
            put("config", HaCompile.compileRoutine(r.name, r.icon, stepsArr, r.on_failure))
        })
        jobs.enqueue(householdId, "script.upsert", payload, "script:${objectId(r.id)}", userId)
        db.write { identityQueries.updateRoutine(r.name, r.icon, stepsJson, r.on_failure, now, r.last_run_at, "pending", null, null, scriptEntityId(r.id), r.id) }
    }

    fun driftedCount(householdId: String): Int =
        db.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }.count { it.sync_status == "drifted" }

    fun reconcile(c: Caller): Int {
        val rows = db.read { identityQueries.selectRoutinesByHousehold(c.householdId).executeAsList() }
            .filter { it.sync_status in setOf("not_synced", "failed", "drifted") }
        val now = time.now()
        for (r in rows) syncRoutineRow(c.householdId, c.userId, r, r.steps, now)
        return rows.size
    }

    fun verificationScripts(householdId: String): List<Pair<String, kotlinx.serialization.json.JsonObject>> {
        return db.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }
            .filter { it.sync_status in setOf("synced", "drifted") }
            .mapNotNull { r ->
                runCatching {
                    val cfg = HaCompile.compileRoutine(r.name, r.icon, parseStepsArray(r.steps), r.on_failure)
                    objectId(r.id) to cfg
                }.getOrNull()
            }
    }


    fun update(c: Caller, id: String, name: String?, iconProvided: Boolean, icon: String?, cleanedStepsJson: String?, onFailure: String?): RoutineView {
        val r = row(c.householdId, id)
        val n = if (name != null) cleanName(name) else r.name
        val ic = if (iconProvided) icon else r.icon
        val st = cleanedStepsJson ?: r.steps
        val of = when (onFailure) { "continue" -> "continue"; "stop" -> "stop"; else -> r.on_failure }
        val t = time.now()
        db.write { identityQueries.updateRoutine(n, ic, st, of, t, r.last_run_at, "pending", null, null, r.ha_entity_id, r.id) }
        val updated = db.read { identityQueries.selectRoutineById(id).executeAsOneOrNull() } ?: return get(c.householdId, id)
        syncRoutineRow(c.householdId, c.userId, updated, st, t)
        return get(c.householdId, id)
    }

    fun remove(c: Caller, id: String) {
        val r = row(c.householdId, id)
        val jobs = configJobs
        if (jobs != null) {
            val st = jobs.status(c.householdId)
            if (st.connected && st.adminTokenSet) {
                jobs.enqueue(c.householdId, "script.delete", json.encodeToString(buildJsonObject { put("objectId", JsonPrimitive(objectId(id))) }), "script:${objectId(id)}", c.userId)
            }
        }
        db.write { identityQueries.deleteRoutine(id) }
    }

    private fun toRun(r: alice.core.db.Routine_runs): RoutineRunView {
        val steps = runCatching { json.decodeFromString<List<StepResult>>(r.steps) }.getOrDefault(emptyList())
        return RoutineRunView(r.id, r.routine_id, r.routine_name, r.household_id, r.user_id, r.state, r.started_at, r.finished_at, steps)
    }

    private fun runRow(householdId: String, runId: String, caller: Caller): alice.core.db.Routine_runs {
        val r = db.read { identityQueries.selectRoutineRunById(runId).executeAsOneOrNull() } ?: throw notFound("Run")
        if (r.household_id != householdId) throw notFound("Run")
        if (caller.role != alice.server.households.Role.ADMIN && r.user_id != caller.userId) throw notFound("Run")
        return r
    }

    fun getRun(c: Caller, runId: String): RoutineRunView = toRun(runRow(c.householdId, runId, c))

    fun listRuns(c: Caller, limit: Int = 50): List<RoutineRunView> {
        val rows = db.read { identityQueries.selectRoutineRunsByHousehold(c.householdId, 200).executeAsList() }
        return rows.filter { c.role == alice.server.households.Role.ADMIN || it.user_id == c.userId }.take(limit).map(::toRun)
    }

    fun execute(c: Caller, routineId: String): RoutineRunView {
        val r = row(c.householdId, routineId)
        val stepsArr = parseStepsArray(r.steps).toList()
        val t = time.now()
        val runId = Ids.next("run")
        val stepResults = stepsArr.mapIndexed { i, def ->
            val type = (def as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull ?: "unknown"
            StepResult(i, type, "pending", null, null, def)
        }
        val stepUpUntil = if (c.steppedUp) t + STEP_UP_WINDOW_MS else 0L
        db.write {
            identityQueries.insertRoutineRun(runId, r.id, r.name, c.householdId, c.userId, "running", t, null, json.encodeToString(stepResults), r.on_failure, 0, null, stepUpUntil, 0)
            identityQueries.updateRoutineLastRun(t, r.id)
        }
        val run = db.read { identityQueries.selectRoutineRunById(runId).executeAsOneOrNull() }!!
        start(run, c, 0, stepUpUntil, null)
        return toRun(run)
    }

    private fun start(runRow: alice.core.db.Routine_runs, caller: Caller, from: Int, stepUpUntil: Long, firstDelayMs: Long?) {
        // Register the run before it starts: `drive` looks itself up in `live` and gives up if it is missing.
        val job = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) {
            drive(runRow.id, caller, runRow.on_failure, from, stepUpUntil, firstDelayMs)
        }
        live[runRow.id] = Live(job)
        job.start()
    }

    private suspend fun drive(runId: String, caller: Caller, onFailure: String, from: Int, stepUpUntil: Long, firstDelayMs: Long?) {
        val l = live[runId] ?: return
        try {
            val cur = db.read { identityQueries.selectRoutineRunById(runId).executeAsOneOrNull() } ?: return
            val run = toRun(cur)
            val mutableSteps = run.steps.toMutableList()
            var anyFailed = mutableSteps.any { it.state == "failed" }
            for (i in from until mutableSteps.size) {
                if (l.cancelled) { mutableSteps[i] = mutableSteps[i].copy(state = "skipped"); continue }
                mutableSteps[i] = mutableSteps[i].copy(state = "running")
                save(runId, run.state, run.finishedAt, mutableSteps, i, null)
                val m = households.getMembership(caller.userId)
                if (m == null || m.householdId != caller.householdId) {
                    mutableSteps[i] = mutableSteps[i].copy(state = "failed", detail = "You no longer have access")
                    anyFailed = true
                    save(runId, run.state, run.finishedAt, mutableSteps, i, null)
                    if (onFailure == "stop") break else continue
                }
                val who = Caller(caller.householdId, caller.userId, m.role, time.now() < stepUpUntil)
                val stepObj = mutableSteps[i].def as? JsonObject
                val type = stepObj?.get("type")?.jsonPrimitive?.contentOrNull
                var ok = true
                var detail: String? = null
                var commandIds: List<String>? = mutableSteps[i].commandIds
                when (type) {
                    "delay" -> {
                        val seconds = stepObj["seconds"]?.jsonPrimitive?.intOrNull ?: 0
                        val ms = if (i == from && firstDelayMs != null) firstDelayMs else seconds * 1000L
                        save(runId, run.state, run.finishedAt, mutableSteps, i, time.now() + ms)
                        val cancelled = try {
                            delay(ms)
                            l.cancelled
                        } catch (_: CancellationException) {
                            true
                        }
                        l.cancelled = l.cancelled || cancelled
                        mutableSteps[i] = mutableSteps[i].copy(state = if (l.cancelled) "skipped" else "ok", detail = if (l.cancelled) "Cancelled" else "Waited ${seconds}s")
                        save(runId, run.state, run.finishedAt, mutableSteps, i, null)
                        if (l.cancelled) continue
                        continue
                    }
                    "mode" -> {
                        if (!can(who.role, Permission.MODE_CHANGE)) { ok = false; detail = "You cannot change the household mode" }
                        else {
                            val mode = stepObj["mode"]?.jsonPrimitive?.contentOrNull ?: "home"
                            runCatching { modes.set(caller.householdId, caller.userId, mode) }.onFailure { ok = false; detail = it.message }
                        }
                    }
                    "scene" -> {
                        val sceneId = stepObj["sceneId"]?.jsonPrimitive?.contentOrNull ?: ""
                        val res = runCatching { scenes.activate(who.toAccess(), sceneId) }.getOrNull()
                        if (res == null) { ok = false; detail = "That scene is no longer available" }
                        else {
                            val (commands, skipped) = res
                            commandIds = commands.map { it.id }
                            if (skipped.isNotEmpty() || commands.any { it.state == alice.server.commands.CommandState.FAILED || it.state == alice.server.commands.CommandState.TIMED_OUT || it.state == alice.server.commands.CommandState.CANCELLED }) {
                                ok = false
                                detail = (skipped.map { "${it.action.entityId}: ${it.reason}" } + commands.filter { it.state != alice.server.commands.CommandState.CONFIRMED && it.state != alice.server.commands.CommandState.ACCEPTED && it.state != alice.server.commands.CommandState.DISPATCHED && it.state != alice.server.commands.CommandState.AUTHORIZED && it.state != alice.server.commands.CommandState.PENDING }.map { "${it.entityId}: ${it.state}" }).joinToString("; ").ifBlank { "Action failed" }
                            }
                        }
                    }
                    "device" -> {
                        val entityId = stepObj["entityId"]?.jsonPrimitive?.contentOrNull ?: ""
                        val action = stepObj["action"]?.jsonPrimitive?.contentOrNull ?: ""
                        val params = (stepObj["parameters"] as? JsonObject)?.mapValues { it.value } ?: emptyMap()
                        val res = runCatching { actions.run(who.toAccess(), listOf(ActionSpec(entityId, action, params))) }.getOrNull()
                        if (res == null) { ok = false; detail = "Failed to run action" }
                        else {
                            val (commands, skipped) = res
                            commandIds = commands.map { it.id }
                            if (skipped.isNotEmpty() || commands.any { it.state == alice.server.commands.CommandState.FAILED || it.state == alice.server.commands.CommandState.TIMED_OUT || it.state == alice.server.commands.CommandState.CANCELLED }) {
                                ok = false
                                detail = (skipped.map { "${it.action.entityId}: ${it.reason}" } + commands.filter { it.state != alice.server.commands.CommandState.CONFIRMED && it.state != alice.server.commands.CommandState.ACCEPTED && it.state != alice.server.commands.CommandState.DISPATCHED && it.state != alice.server.commands.CommandState.AUTHORIZED && it.state != alice.server.commands.CommandState.PENDING }.map { "${it.entityId}: ${it.state}" }).joinToString("; ").ifBlank { "Action failed" }
                            }
                        }
                    }
                    else -> { ok = false; detail = "Unknown step type" }
                }
                mutableSteps[i] = mutableSteps[i].copy(state = if (ok) "ok" else "failed", detail = detail, commandIds = commandIds)
                save(runId, run.state, run.finishedAt, mutableSteps, i, null)
                if (!ok) { anyFailed = true; if (onFailure == "stop") break }
            }
            val stopped = mutableSteps.any { it.state == "pending" }
            for (i in mutableSteps.indices) if (mutableSteps[i].state == "pending") mutableSteps[i] = mutableSteps[i].copy(state = "skipped")
            val finalState = when {
                l.cancelled -> "cancelled"
                stopped -> "stopped"
                anyFailed -> "failed"
                else -> "completed"
            }
            val finishedAt = time.now()
            db.write { identityQueries.updateRoutineRun(finalState, finishedAt, json.encodeToString(mutableSteps), mutableSteps.size.toLong(), null, if (l.cancelled) 1L else 0L, runId) }
            events?.publish(RoutineRunEvent(caller.householdId, finishedAt.toString(), caller.userId, cur.routine_id, cur.routine_name, finalState))
            runCatching {
                if (finalState != "cancelled") {
                    val summary = if (finalState == "completed") "ran the “${cur.routine_name}” routine" else "ran the “${cur.routine_name}” routine, but not everything worked"
                    activity.value
                        ?.record(caller.householdId, "routine", caller.userId, null, null, summary, if (finalState == "completed") "info" else "warn")
                }
            }
        } catch (_: CancellationException) {
            val cur2 = db.read { identityQueries.selectRoutineRunById(runId).executeAsOneOrNull() } ?: return
            val run2 = toRun(cur2)
            val steps = run2.steps.map {
                when (it.state) {
                    "running" -> it.copy(state = "skipped", detail = "Cancelled")
                    "pending" -> it.copy(state = "skipped")
                    else -> it
                }
            }
            db.write { identityQueries.updateRoutineRun("cancelled", time.now(), json.encodeToString(steps), steps.size.toLong(), null, 1, runId) }
            events?.publish(RoutineRunEvent(caller.householdId, time.now().toString(), caller.userId, cur2.routine_id, cur2.routine_name, "cancelled"))
        } catch (_: Throwable) {
            val cur2 = db.read { identityQueries.selectRoutineRunById(runId).executeAsOneOrNull() } ?: return
            val run2 = toRun(cur2)
            val steps = run2.steps.map { if (it.state == "running" || it.state == "pending") it.copy(state = "failed", detail = "Unexpected error") else it }
            db.write { identityQueries.updateRoutineRun("failed", time.now(), json.encodeToString(steps), steps.size.toLong(), null, 0, runId) }
        } finally {
            live.remove(runId)
        }
    }

    private fun save(runId: String, state: String, finishedAt: Long?, steps: List<StepResult>, nextStep: Int, resumeAt: Long?) {
        db.write { identityQueries.updateRoutineRun(state, finishedAt, json.encodeToString(steps), nextStep.toLong(), resumeAt, 0, runId) }
    }

    fun cancel(c: Caller, runId: String): RoutineRunView {
        val r = runRow(c.householdId, runId, c)
        if (r.state != "running") throw AppException(ErrorCode.CONFLICT, "That run already ${if (r.state == "completed") "finished" else r.state}", 409)
        live[runId]?.let { it.cancelled = true; it.job.cancel(CancellationException("cancelled")) }
        db.write { identityQueries.updateRoutineRunCancelRequested(runId) }
        return getRun(c, runId)
    }

    /** Stops any live routine jobs owned by this service. Safe to call more than once. */
    fun stop() { scope.cancel() }

    fun resumeInterrupted(): Int {
        val stuck = db.read { identityQueries.selectRunningRoutineRuns().executeAsList() }
        val now = time.now()
        for (r in stuck) {
            val m = households.getMembership(r.user_id)
            if (m == null || m.householdId != r.household_id) {
                val steps = toRun(r).steps.map { if (it.state == "running" || it.state == "pending") it.copy(state = "failed", detail = "You no longer have access") else it }
                db.write { identityQueries.updateRoutineRun("failed", now, json.encodeToString(steps), steps.size.toLong(), null, 0, r.id) }
                continue
            }
            val run = toRun(r)
            val idx = run.steps.indexOfFirst { it.state == "running" }
            var from = if (idx == -1) run.steps.indexOfFirst { it.state == "pending" } else idx
            if (from == -1) { db.write { identityQueries.updateRoutineRun("completed", now, json.encodeToString(run.steps), run.steps.size.toLong(), null, 0, r.id) }; continue }
            var delayMs: Long? = null
            val steps = run.steps.toMutableList()
            if (idx != -1) {
                val t = (steps[idx].def as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull
                val resumeAt = r.resume_at
                if (t == "delay" && resumeAt != null) {
                    delayMs = maxOf(0L, resumeAt - now)
                } else {
                    steps[idx] = steps[idx].copy(state = "failed", detail = "Interrupted by a restart; it may or may not have happened")
                    if (r.on_failure == "stop") {
                        for (i in steps.indices) if (steps[i].state == "pending") steps[i] = steps[i].copy(state = "skipped")
                        db.write { identityQueries.updateRoutineRun("stopped", now, json.encodeToString(steps), steps.size.toLong(), null, 0, r.id) }
                        continue
                    }
                    from = idx + 1
                    db.write { identityQueries.updateRoutineRun("running", null, json.encodeToString(steps), from.toLong(), null, 0, r.id) }
                }
            }
            val caller = Caller(r.household_id, r.user_id, m.role, false)
            val refreshed = db.read { identityQueries.selectRoutineRunById(r.id).executeAsOneOrNull() } ?: continue
            start(refreshed, caller, from, r.step_up_until, delayMs)
        }
        db.write { identityQueries.deleteOldCompletedRoutineRuns(now - RUN_RETENTION_MS) }
        return stuck.size
    }
}
