package alice.server.http

import alice.core.error.AppException
import alice.core.error.ErrorCode
import io.ktor.server.application.createApplicationPlugin
import io.ktor.server.request.contentLength

class BodyLimitConfig {
    var maxBytes: Long = 1_000_000
}

/**
 * Refuses a request that declares a body larger than the limit before anything reads it.
 * shortcut: a chunked body declares no length and is not capped here; put the proxy's body limit in front when exposed.
 */
val BodyLimitPlugin = createApplicationPlugin(name = "BodyLimit", createConfiguration = ::BodyLimitConfig) {
    onCall { call ->
        val length = call.request.contentLength()
        if (length != null && length > pluginConfig.maxBytes) {
            throw AppException(ErrorCode.VALIDATION_ERROR, "The request body is too large", 413)
        }
    }
}
