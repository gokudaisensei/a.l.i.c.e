package alice.server.api

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * `{ "error": { "code", "message", "details"? } }` — see backend/docs/API.md.
 * `details` disappears when absent instead of serialising as `null`.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ErrorBody(
    val code: String,
    val message: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val details: JsonElement? = null,
)

@Serializable
data class ErrorEnvelope(
    val error: ErrorBody,
)
