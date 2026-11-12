package alice.worker

import alice.core.concurrent.runCatchingNonCancellation
import alice.core.db.Database
import alice.core.security.Sealed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import org.slf4j.LoggerFactory
import java.util.concurrent.atomic.AtomicBoolean

class ConfigWorker(
    private val db: Database,
    private val privateKeyB64: String?,
    private val name: String = "config-worker",
    private val retryDelayMs: Long = 5_000,
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val apiFactory: (String, String, Json) -> HaAdminApi = { baseUrl, token, j -> HaAdminApi(baseUrl, token, j) },
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val running = AtomicBoolean(false)
    private val stopping = AtomicBoolean(false)

    private fun now() = System.currentTimeMillis()

    private fun heartbeat(info: String? = null) {
        runCatchingNonCancellation {
            db.write { identityQueries.upsertConfigWorkerHeartbeat(name, now(), info) }
        }
    }

    fun recoverInterrupted(): Int {
        return runCatchingNonCancellation {
            db.write {
                identityQueries.resetRunningConfigJobs()
                0
            }
            // SQLDelight delete/update count not exposed; best-effort recovery.
        }.getOrDefault(0)
    }

    private fun pemOrDerToB64(key: String): String {
        val trimmed = key.trim()
        if (!trimmed.contains("-----BEGIN")) return trimmed
        val b64 = trimmed.lineSequence()
            .filter { !it.startsWith("-----") }
            .joinToString("")
            .replace("\\s".toRegex(), "")
        return b64
    }

    suspend fun tick(): Boolean {
        heartbeat()
        val job = db.write {
            val next = identityQueries.selectNextPendingConfigJob(now()).executeAsOneOrNull() ?: return@write null
            identityQueries.claimConfigJob(now(), next.id)
            identityQueries.selectConfigJobById(next.id).executeAsOneOrNull()
        } ?: return false

        if (job.status != "running") return false

        val operation = job.operation
        val payloadStr = job.payload
        var api: HaAdminApi? = null
        try {
            val payload = runCatchingNonCancellation { json.parseToJsonElement(payloadStr).jsonObject }.getOrDefault(JsonObject(emptyMap()))
            ConfigOps.validate(operation, payload)

            val conn = db.read { identityQueries.selectHaConnectionById(job.connection_id).executeAsOneOrNull() }
                ?: throw ConfigOps.ConfigOpError("That Home Assistant connection no longer exists")
            val enc = conn.admin_token_enc ?: throw ConfigOps.ConfigOpError("No admin token has been stored for this Home Assistant")
            val pk = privateKeyB64 ?: throw ConfigOps.ConfigOpError("Worker private key is not configured")
            val token = try { Sealed.open(enc, pemOrDerToB64(pk)) } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                throw ConfigOps.ConfigOpError("The stored admin token cannot be read by this worker")
            }

            api = apiFactory(conn.base_url, token, json)
            val result = perform(api, operation, payload)
            db.write { identityQueries.finishConfigJob("done", now(), result?.toString(), null, job.id) }
        } catch (e: Exception) {
            // Only cancelling this coroutine may stop the worker. A timeout inside the job (`withTimeout` in a call to
            // Home Assistant) also arrives as a CancellationException, but it is a failed job, not a stop request.
            if (e is CancellationException && (e !is kotlinx.coroutines.TimeoutCancellationException || !currentCoroutineContext().isActive)) throw e
            val msg = (e.message ?: e.toString()).take(500)
            val isRestore = operation == "backup.restore"
            val timeoutLike = e is HaTimeout || e is kotlinx.coroutines.TimeoutCancellationException || (e.cause is kotlinx.coroutines.TimeoutCancellationException)
            val permanent = e is ConfigOps.ConfigOpError || (e is HaConfigHttpError && e.status in setOf(400, 401, 403, 404, 405)) || isRestore || timeoutLike
            if (!permanent && job.attempts.toInt() < 3) {
                log.warn("config job failed, will retry: id={} op={} attempt={} err={}", job.id, operation, job.attempts, msg)
                db.write { identityQueries.retryConfigJob(msg, now() + retryDelayMs * (job.attempts + 1), job.id) }
            } else {
                if (isRestore) {
                    log.warn("restore job ended without confirmed completion (no retry): id={} err={}", job.id, msg)
                } else {
                    log.error("config job failed: id={} op={} err={}", job.id, operation, msg)
                }
                db.write { identityQueries.finishConfigJob("failed", now(), null, msg, job.id) }
            }
        } finally {
            runCatchingNonCancellation { api?.close() }
        }
        return true
    }

    private fun reqString(payload: JsonObject, op: String, key: String): String =
        (payload[key] as? JsonPrimitive)?.contentOrNull
            ?: throw ConfigOps.ConfigOpError("$op needs \"$key\"")

    private fun reqElement(payload: JsonObject, op: String, key: String): JsonElement =
        payload[key] ?: throw ConfigOps.ConfigOpError("$op needs \"$key\"")

    private suspend fun perform(api: HaAdminApi, op: String, payload: JsonObject): JsonElement? {
        return when (op) {
            "script.upsert" -> {
                val objectId = reqString(payload, op, "objectId")
                val config = reqElement(payload, op, "config")
                api.putScript(objectId, config)
                api.reload("script")
                buildJsonObject { put("entityId", "script.$objectId") }
            }
            "script.delete" -> {
                val objectId = reqString(payload, op, "objectId")
                api.deleteScript(objectId)
                api.reload("script")
                buildJsonObject { }
            }
            "automation.upsert" -> {
                val id = reqString(payload, op, "id")
                val config = reqElement(payload, op, "config")
                val enabled = payload["enabled"]?.jsonPrimitive?.booleanOrNull ?: true
                api.putAutomation(id, config)
                api.reload("automation")
                val entityId = runCatchingNonCancellation { api.automationEntityId(id) }.getOrNull()
                if (entityId != null) api.setAutomationEnabled(entityId, enabled)
                buildJsonObject { entityId?.let { put("entityId", it) } }
            }
            "automation.delete" -> {
                val id = reqString(payload, op, "id")
                api.deleteAutomation(id)
                api.reload("automation")
                buildJsonObject { }
            }
            "automation.set_enabled" -> {
                val id = reqString(payload, op, "id")
                val enabled = payload["enabled"]?.jsonPrimitive?.booleanOrNull ?: true
                val entityId = api.automationEntityId(id) ?: throw ConfigOps.ConfigOpError("That automation is not in Home Assistant yet")
                api.setAutomationEnabled(entityId, enabled)
                buildJsonObject { put("entityId", entityId); put("enabled", enabled) }
            }
            "helper.ensure_mode_select" -> {
                val options = (payload["options"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: listOf("home","away","night","vacation")
                api.ensureModeSelect(options)
            }
            "voice.expose" -> {
                val ids = (payload["entityIds"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()
                val expose = payload["expose"]?.jsonPrimitive?.booleanOrNull ?: true
                api.exposeEntities(ids, expose)
                buildJsonObject { put("exposed", expose) }
            }
            "config.verify" -> {
                val scripts = payload["scripts"] as? JsonArray ?: JsonArray(emptyList())
                val autos = payload["automations"] as? JsonArray ?: JsonArray(emptyList())
                val drifted = buildJsonArray {
                    for (x in scripts.mapNotNull { it as? JsonObject }) {
                        val objectId = x["objectId"]?.jsonPrimitive?.contentOrNull ?: continue
                        val want = x["config"] ?: continue
                        val have = api.getScript(objectId)
                        when {
                            have == null -> add(buildJsonObject { put("kind","script"); put("id", objectId); put("reason","missing") })
                            !ConfigOps.sameConfig(want, have) -> add(buildJsonObject { put("kind","script"); put("id", objectId); put("reason","changed") })
                        }
                    }
                    for (x in autos.mapNotNull { it as? JsonObject }) {
                        val id = x["id"]?.jsonPrimitive?.contentOrNull ?: continue
                        val want = x["config"] ?: continue
                        val enabled = x["enabled"]?.jsonPrimitive?.booleanOrNull ?: true
                        val have = api.getAutomation(id)
                        if (have == null) {
                            add(buildJsonObject { put("kind","automation"); put("id", id); put("reason","missing") })
                            continue
                        }
                        if (!ConfigOps.sameConfig(want, have)) {
                            add(buildJsonObject { put("kind","automation"); put("id", id); put("reason","changed") })
                            continue
                        }
                        val on = api.automationEnabled(id)
                        if (on != null && on != enabled) add(buildJsonObject { put("kind","automation"); put("id", id); put("reason","enabled_changed") })
                    }
                }
                buildJsonObject { put("drifted", drifted); put("checked", scripts.size + autos.size) }
            }
            "backup.generate" -> api.generateBackup((payload["name"] as? JsonPrimitive)?.contentOrNull ?: "Alice backup")
            "backup.info" -> api.backupInfo((payload["backupId"] as? JsonPrimitive)?.contentOrNull ?: "")
            "backup.delete" -> { api.deleteBackup((payload["backupId"] as? JsonPrimitive)?.contentOrNull ?: ""); buildJsonObject { } }
            "backup.restore" -> { api.restoreBackup((payload["backupId"] as? JsonPrimitive)?.contentOrNull ?: ""); buildJsonObject { } }
            else -> throw ConfigOps.ConfigOpError("Unsupported operation: $op")
        }
    }

    suspend fun drain(max: Int = 200): Int {
        var n = 0
        while (n < max && !stopping.get() && tick()) n++
        return n
    }

    suspend fun runLoop(intervalMs: Long = 1000) {
        if (!running.compareAndSet(false, true)) return
        stopping.set(false)
        recoverInterrupted()
        heartbeat("""{"status":"running","name":"$name"}""")
        log.info("config worker '{}' started", name)
        try {
            while (!stopping.get()) {
                val did = runCatchingNonCancellation { drain() }.getOrElse { e -> log.error("worker loop error", e); 0 }
                if (did == 0) delay(intervalMs) else delay(50)
                // periodic cleanup of old applied jobs could be added; keep lightweight
            }
        } finally {
            heartbeat("""{"status":"stopped","name":"$name"}""")
            running.set(false)
            log.info("config worker '{}' stopped", name)
        }
    }

    fun stop() { stopping.set(true) }
}
