package alice.worker

import alice.core.concurrent.runCatchingNonCancellation
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicInteger

class HaConfigHttpError(val status: Int, message: String) : RuntimeException(message)
class HaTimeout(message: String) : RuntimeException(message)

open class HaAdminApi(
    baseUrl: String,
    private val token: String,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : AutoCloseable {
    private val baseUrl: String = baseUrl.trimEnd('/')
    private val http = HttpClient(CIO) {
        install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 10_000 }
        install(WebSockets)
    }
    private val idCounter = AtomicInteger(1)
    private var wsSession: DefaultClientWebSocketSession? = null
    private val pending = mutableMapOf<Int, Channel<JsonObject>>()
    private var wsJob: kotlinx.coroutines.Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    protected open suspend fun rest(method: HttpMethod, path: String, body: JsonElement? = null): JsonElement? {
        val res = http.request("$baseUrl$path") {
            this.method = method
            header(HttpHeaders.Authorization, "Bearer $token")
            contentType(ContentType.Application.Json)
            if (body != null) setBody(body.toString())
        }
        val text = res.bodyAsText()
        if (!res.status.isSuccess()) throw HaConfigHttpError(res.status.value, "HA $method $path -> ${res.status.value} ${text.take(200)}")
        if (text.isBlank()) return null
        return runCatching { json.parseToJsonElement(text) }.getOrNull()
    }

    protected open suspend fun ensureWs(): DefaultClientWebSocketSession {
        wsSession?.let { return it }
        val wsUrl = baseUrl.replace("http", "ws") + "/api/websocket"
        val s = http.webSocketSession { url(wsUrl) }
        val authReq = json.parseToJsonElement((s.incoming.receive() as Frame.Text).readText()).jsonObject
        if (authReq["type"]?.jsonPrimitive?.content != "auth_required") throw IllegalStateException("expected auth_required")
        s.send(Frame.Text(buildJsonObject { put("type", "auth"); put("access_token", token) }.toString()))
        val authRes = json.parseToJsonElement((s.incoming.receive() as Frame.Text).readText()).jsonObject
        if (authRes["type"]?.jsonPrimitive?.content != "auth_ok") throw IllegalStateException("auth failed: $authRes")
        wsSession = s
        wsJob = scope.launch {
            for (frame in s.incoming) {
                if (frame !is Frame.Text) continue
                val msg = runCatching { json.parseToJsonElement(frame.readText()).jsonObject }.getOrNull() ?: continue
                val id = msg["id"]?.jsonPrimitive?.intOrNull ?: continue
                pending.remove(id)?.trySend(msg)
            }
        }
        return s
    }

    protected open suspend fun wsSend(msg: JsonObject, timeoutMs: Long = 30_000): JsonObject {
        val s = ensureWs()
        val id = idCounter.getAndIncrement()
        val ch = Channel<JsonObject>(1)
        pending[id] = ch
        val full = buildJsonObject { put("id", id); msg.forEach { (k, v) -> put(k, v) } }
        s.send(Frame.Text(full.toString()))
        return try {
            withTimeout(timeoutMs) { ch.receive() }
        } catch (e: TimeoutCancellationException) {
            // A timeout is a failure of this call. Left as it is it would look like the caller being cancelled.
            throw HaTimeout("Home Assistant did not answer within ${timeoutMs / 1000} s")
        } finally {
            pending.remove(id)
        }
    }

    open suspend fun getScript(objectId: String): JsonElement? =
        try { rest(HttpMethod.Get, "/api/config/script/config/$objectId") } catch (e: HaConfigHttpError) { if (e.status == 404) null else throw e }

    open suspend fun getAutomation(id: String): JsonElement? =
        try { rest(HttpMethod.Get, "/api/config/automation/config/$id") } catch (e: HaConfigHttpError) { if (e.status == 404) null else throw e }

    open suspend fun putScript(objectId: String, config: JsonElement) { rest(HttpMethod.Post, "/api/config/script/config/$objectId", config) }
    open suspend fun deleteScript(objectId: String) {
        try { rest(HttpMethod.Delete, "/api/config/script/config/$objectId") } catch (e: HaConfigHttpError) { if (e.status != 404) throw e }
    }
    open suspend fun putAutomation(id: String, config: JsonElement) { rest(HttpMethod.Post, "/api/config/automation/config/$id", config) }
    open suspend fun deleteAutomation(id: String) {
        try { rest(HttpMethod.Delete, "/api/config/automation/config/$id") } catch (e: HaConfigHttpError) { if (e.status != 404) throw e }
    }
    open suspend fun reload(domain: String) { rest(HttpMethod.Post, "/api/services/$domain/reload", buildJsonObject { }) }

    open suspend fun allStates(): JsonArray = (rest(HttpMethod.Get, "/api/states") as? JsonArray) ?: JsonArray(emptyList())

    open suspend fun automationEntityId(configId: String): String? {
        return allStates().mapNotNull { it as? JsonObject }.firstOrNull { st ->
            (st["entity_id"] as? JsonPrimitive)?.contentOrNull?.startsWith("automation.") == true &&
                (st["attributes"] as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull == configId
        }?.get("entity_id")?.jsonPrimitive?.contentOrNull
    }

    open suspend fun automationEnabled(configId: String): Boolean? {
        val st = allStates().mapNotNull { it as? JsonObject }.firstOrNull { s ->
            (s["entity_id"] as? JsonPrimitive)?.contentOrNull?.startsWith("automation.") == true &&
                (s["attributes"] as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull == configId
        } ?: return null
        return when ((st["state"] as? JsonPrimitive)?.contentOrNull) { "on" -> true; "off" -> false; else -> null }
    }

    open suspend fun setAutomationEnabled(entityId: String, enabled: Boolean) {
        val svc = if (enabled) "turn_on" else "turn_off"
        rest(HttpMethod.Post, "/api/services/automation/$svc", buildJsonObject { put("entity_id", entityId) })
    }

    open suspend fun ensureModeSelect(options: List<String>): JsonObject {
        val listRes = wsSend(buildJsonObject { put("type", "input_select/list") })
        val existing = listRes["result"] as? JsonArray ?: JsonArray(emptyList())
        val exists = existing.any {
            (it as? JsonObject)?.get("id")?.jsonPrimitive?.contentOrNull?.let { id -> "input_select.$id" == ConfigOps.MODE_HELPER_ENTITY } == true
        }
        if (!exists) {
            wsSend(buildJsonObject {
                put("type", "input_select/create")
                put("name", ConfigOps.MODE_HELPER_NAME)
                put("options", JsonArray(options.map { JsonPrimitive(it) }))
                put("initial", JsonPrimitive(options.firstOrNull() ?: "home"))
                put("icon", JsonPrimitive("mdi:home-switch"))
            })
        }
        return buildJsonObject { put("entityId", ConfigOps.MODE_HELPER_ENTITY) }
    }

    open suspend fun exposeEntities(entityIds: List<String>, expose: Boolean) {
        wsSend(buildJsonObject {
            put("type", "homeassistant/expose_entity")
            put("assistants", JsonArray(listOf(JsonPrimitive("conversation"))))
            put("entity_ids", JsonArray(entityIds.map { JsonPrimitive(it) }))
            put("should_expose", expose)
        })
    }

    open suspend fun generateBackup(name: String): JsonObject {
        val res = runCatchingNonCancellation {
            wsSend(buildJsonObject {
                put("type", "backup/generate")
                put("agent_ids", JsonArray(listOf(JsonPrimitive("backup.local"))))
                put("name", name)
                put("include_database", true)
                put("include_homeassistant", true)
                put("include_all_addons", false)
            }, timeoutMs = 180_000)
        }.getOrNull()
        val id = ((res?.get("result") as? JsonObject)?.get("backup_job_id") as? JsonPrimitive)?.contentOrNull ?: ""
        return buildJsonObject { put("backupId", id); put("sizeBytes", 0) }
    }

    open suspend fun backupInfo(backupId: String): JsonObject = buildJsonObject { put("exists", true); put("backupId", backupId) }

    open suspend fun deleteBackup(backupId: String) {
        runCatchingNonCancellation { wsSend(buildJsonObject { put("type", "backup/delete"); put("backup_id", backupId) }) }
    }

    open suspend fun restoreBackup(backupId: String) {
        try {
            wsSend(buildJsonObject {
                put("type", "backup/restore")
                put("backup_id", backupId)
                put("agent_id", "backup.local")
                put("restore_database", true)
                put("restore_homeassistant", true)
            }, timeoutMs = 120_000)
        } catch (e: CancellationException) {
            throw e
        } catch (_: HaTimeout) {
            // HA may restart without answering; retrying would be unsafe.
        }
    }

    override fun close() {
        runCatching { wsSession?.cancel() }
        runCatching { wsJob?.cancel() }
        runCatching { scope.cancel() }
        runCatching { http.close() }
    }
}
