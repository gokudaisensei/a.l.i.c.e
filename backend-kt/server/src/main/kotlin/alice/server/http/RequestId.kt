package alice.server.http

import io.ktor.server.application.ApplicationCall
import io.ktor.server.application.createApplicationPlugin
import io.ktor.util.AttributeKey
import java.util.UUID

const val REQUEST_ID_HEADER = "X-Request-Id"

class RequestIdConfig {
    var headerName: String = REQUEST_ID_HEADER
}

private val VALID_REQUEST_ID = Regex("^[A-Za-z0-9._:-]{1,64}$")

internal fun normalizeRequestId(existing: String?): String =
    existing?.takeIf { VALID_REQUEST_ID.matches(it) } ?: UUID.randomUUID().toString()

val RequestIdPlugin = createApplicationPlugin(name = "RequestId", createConfiguration = ::RequestIdConfig) {
    onCall { call ->
        val requestId = normalizeRequestId(call.request.headers[pluginConfig.headerName])
        call.attributes.put(RequestIdKey, requestId)
        call.response.headers.append(pluginConfig.headerName, requestId)
    }
}

val RequestIdKey = AttributeKey<String>("alice.requestId")

fun ApplicationCall.requestId(): String = attributes.getOrNull(RequestIdKey) ?: "unknown"
