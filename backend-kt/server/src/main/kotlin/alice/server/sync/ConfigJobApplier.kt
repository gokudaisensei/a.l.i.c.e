package alice.server.sync

import alice.core.db.Database
import alice.core.time.SystemTimeProvider
import alice.core.time.TimeProvider
import alice.ha.ConfigOps
import alice.ha.HomeAssistantGateway
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class ConfigJobApplier(
    private val db: Database,
    private val gateway: HomeAssistantGateway,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val time: TimeProvider = SystemTimeProvider,
) {
    data class ApplyResult(val applied: Int, val failed: Int)

    suspend fun applyPending(householdId: String? = null): ApplyResult {
        // `null` means "every household that needs the in-process fallback": connections without an
        // admin token, because jobs for connections with an admin token are owned by the worker.
        // A job already marked `running` belongs to the worker and is never touched here.
        val householdIds = if (householdId != null) {
            listOf(householdId)
        } else {
            db.read { identityQueries.selectAllHouseholds().executeAsList().map { it.id } }
        }
        var applied = 0
        var failed = 0
        for (hid in householdIds) {
            val conn = db.read { identityQueries.selectHaConnectionByHousehold(hid).executeAsOneOrNull() } ?: continue
            if (conn.admin_token_enc != null) continue
            val jobs = db.read { identityQueries.selectPendingConfigJobs(conn.id).executeAsList() }
                .filter { it.status == "pending" }
            val now = time.now()
            for (job in jobs) {
                try {
                    db.write { identityQueries.updateConfigJobStatus("running", now, null, null, null, null, job.id) }
                    val result = perform(job.operation, job.payload)
                    db.write { identityQueries.updateConfigJobStatus("done", now, time.now(), result, null, time.now(), job.id) }
                    postApply(job.household_id, job.operation, job.payload, result, null)
                    applied++
                } catch (e: Exception) {
                    val msg = (e.message ?: e.toString()).take(500)
                    db.write { identityQueries.updateConfigJobStatus("failed", now, time.now(), null, msg, time.now(), job.id) }
                    postApply(job.household_id, job.operation, job.payload, null, msg)
                    failed++
                }
            }
        }
        return ApplyResult(applied, failed)
    }

    suspend fun applyJob(jobId: String): Boolean {
        val job = db.read { identityQueries.selectConfigJobById(jobId).executeAsOneOrNull() } ?: return false
        val now = time.now()
        return try {
            db.write { identityQueries.updateConfigJobStatus("running", now, null, null, null, null, job.id) }
            val result = perform(job.operation, job.payload)
            db.write { identityQueries.updateConfigJobStatus("done", now, time.now(), result, null, time.now(), job.id) }
            postApply(job.household_id, job.operation, job.payload, result, null)
            true
        } catch (e: Exception) {
            val msg = (e.message ?: e.toString()).take(500)
            db.write { identityQueries.updateConfigJobStatus("failed", now, time.now(), null, msg, time.now(), job.id) }
            postApply(job.household_id, job.operation, job.payload, null, msg)
            false
        }
    }

    private suspend fun perform(operation: String, payloadJson: String): String? {
        val payload = alice.core.concurrent.runCatchingNonCancellation { json.parseToJsonElement(payloadJson).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        return when (operation) {
            "helper.ensure_mode_select" -> ensureModeSelect(payload)
            "voice.expose" -> exposeVoice(payload)
            "script.upsert", "script.delete" -> {
                // HA script config CRUD requires REST config API; websocket-only gateway cannot create/delete scripts.
                // Keep lifecycle honest: operation is recorded/applied as failed with explicit reason unless a REST-capable worker is present.
                throw IllegalStateException("Script sync requires Home Assistant config REST API (external config-worker)")
            }
            "automation.upsert", "automation.delete", "automation.set_enabled" -> {
                // HA automation config CRUD/enable via config endpoints requires REST/admin APIs in typical setups.
                // Best-effort: if enabling/disabling and entity id known, try service call via websocket.
                if (operation == "automation.set_enabled") {
                    val entityId = payload["entityId"]?.let { (it as? JsonPrimitive)?.content }
                    val enabled = payload["enabled"]?.let { (it as? JsonPrimitive)?.content?.toBooleanStrictOrNull() } ?: true
                    if (entityId != null) {
                        val svc = if (enabled) "turn_on" else "turn_off"
                        gateway.callService(alice.ha.HaServiceCallInput("automation", svc, target = alice.ha.HaServiceTarget(entity_id = listOf(entityId))))
                        return """{"entityId":"$entityId","enabled":$enabled}"""
                    }
                }
                throw IllegalStateException("Automation sync requires Home Assistant config REST API (external config-worker)")
            }
            else -> throw IllegalStateException("Unsupported config operation: $operation")
        }
    }

    private suspend fun ensureModeSelect(payload: JsonObject): String {
        val options = (payload["options"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: listOf("home", "away", "night", "vacation")
        val list = alice.core.concurrent.runCatchingNonCancellation { gateway.sendRawCommand(buildJsonObject { put("type", "input_select/list") }) }.getOrNull()
        val exists = list?.get("result")?.jsonArray?.any {
            (it as? JsonObject)?.get("id")?.jsonPrimitive?.content?.let { id -> "input_select.$id" == ConfigOps.MODE_HELPER_ENTITY } == true
        } == true
        if (!exists) {
            alice.core.concurrent.runCatchingNonCancellation {
                gateway.sendRawCommand(buildJsonObject {
                    put("type", "input_select/create")
                    put("name", ConfigOps.MODE_HELPER_NAME)
                    put("options", JsonArray(options.map { JsonPrimitive(it) }))
                    put("initial", JsonPrimitive(options.first()))
                    put("icon", JsonPrimitive("mdi:home-switch"))
                })
            }.onFailure {
                throw IllegalStateException("Unable to create mode helper via HA websocket: ${it.message}")
            }
        }
        return """{"entityId":"${ConfigOps.MODE_HELPER_ENTITY}"}"""
    }

    private suspend fun exposeVoice(payload: JsonObject): String {
        val entityIds = (payload["entityIds"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        val expose = payload["expose"]?.let { (it as? JsonPrimitive)?.content?.toBooleanStrictOrNull() } ?: true
        if (entityIds.isEmpty()) return "{}"
        gateway.sendRawCommand(buildJsonObject {
            put("type", "homeassistant/expose_entity")
            put("assistants", JsonArray(listOf(JsonPrimitive("conversation"))))
            put("entity_ids", JsonArray(entityIds.map { JsonPrimitive(it) }))
            put("should_expose", JsonPrimitive(expose))
        })
        return """{"exposed":$expose}"""
    }

    private fun postApply(householdId: String, operation: String, payloadJson: String, result: String?, error: String?) {
        val payload = runCatching { json.parseToJsonElement(payloadJson).jsonObject }.getOrNull()
        val now = time.now()
        if (operation == "voice.expose") {
            val ids = (payload?.get("entityIds") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
            for (eid in ids) {
                val current = db.read { identityQueries.selectEntitySettings(householdId, alice.ha.Connections.DEFAULT_ID, eid).executeAsOneOrNull() } ?: continue
                db.write {
                    identityQueries.upsertEntitySettings(
                        connection_id = alice.ha.Connections.DEFAULT_ID,
                        entity_id = eid,
                        household_id = householdId,
                        power_limit_w = current.power_limit_w,
                        left_open_after_ms = current.left_open_after_ms,
                        voice_exposed = current.voice_exposed,
                        voice_sync_status = if (error == null) "synced" else "failed",
                        voice_sync_error = error,
                        updated_at = now,
                    )
                }
            }
        }
        if (operation == "script.upsert" || operation == "script.delete") {
            val objectId = payload?.get("objectId")?.let { (it as? JsonPrimitive)?.content } ?: return
            // scene
            val scene = db.read { identityQueries.selectScenesByHousehold(householdId).executeAsList() }.firstOrNull {
                "alice_scene_${it.id.removePrefix("scn_").replace("-", "_")}" == objectId
            }
            if (scene != null) {
                val status = if (error == null) "synced" else "failed"
                db.write {
                    identityQueries.updateScene(scene.name, scene.icon, scene.description, scene.actions, scene.updated_at, scene.last_run_at, status, error, if (error == null) now else scene.synced_at, scene.ha_entity_id ?: "script.$objectId", scene.id)
                }
                return
            }
            // routine
            val routine = db.read { identityQueries.selectRoutinesByHousehold(householdId).executeAsList() }.firstOrNull {
                "alice_routine_${it.id.removePrefix("rtn_").replace("-", "_")}" == objectId
            }
            if (routine != null) {
                val status = if (error == null) "synced" else "failed"
                db.write {
                    identityQueries.updateRoutine(routine.name, routine.icon, routine.steps, routine.on_failure, routine.updated_at, routine.last_run_at, status, error, if (error == null) now else routine.synced_at, routine.ha_entity_id ?: "script.$objectId", routine.id)
                }
            }
        }
        if (operation == "automation.upsert" || operation == "automation.delete" || operation == "automation.set_enabled") {
            val cid = payload?.get("id")?.let { (it as? JsonPrimitive)?.content }
                ?: payload?.get("configId")?.let { (it as? JsonPrimitive)?.content }
                ?: return
            val atm = db.read { identityQueries.selectAutomationsByHousehold(householdId).executeAsList() }.firstOrNull {
                "alice_auto_${it.id.removePrefix("atm_").replace("-", "_")}" == cid
            } ?: return
            val status = if (error == null) "synced" else "failed"
            val entityId = runCatching { json.parseToJsonElement(result ?: "{}").jsonObject["entityId"]?.jsonPrimitive?.content }.getOrNull()
                ?: atm.ha_entity_id ?: "automation.$cid"
            db.write {
                identityQueries.updateAutomation(atm.name, atm.definition, atm.enabled, status, error, if (error == null) now else atm.synced_at, entityId, atm.compiled_hash, atm.last_triggered_at, atm.updated_at, atm.id)
            }
        }
    }
}
