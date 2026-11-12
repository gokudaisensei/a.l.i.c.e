package alice.core.error

import kotlinx.serialization.json.JsonElement

/**
 * The wire contract, same as `backend/docs/API.md`:
 *
 * ```json
 * { "error": { "code": "snake_case", "message": "…", "details"?: … } }
 * ```
 *
 * The status travels with the exception so route code stays declarative; the
 * HTTP layer turns it into a response. [headers] carries response headers a
 * failure needs, chiefly `Retry-After` on 429s.
 */
class AppException(
    val code: String,
    override val message: String,
    val status: Int,
    val details: JsonElement? = null,
    val headers: Map<String, String> = emptyMap(),
    cause: Throwable? = null,
) : RuntimeException(message, cause)

/** Factories mirroring `backend/src/core/errors/errors.ts`. */
fun appError(
    status: Int,
    code: String,
    message: String,
    details: JsonElement? = null,
    headers: Map<String, String> = emptyMap(),
) = AppException(code, message, status, details, headers)

fun notFound(what: String) = AppException(ErrorCode.NOT_FOUND, "$what not found", 404)
fun forbidden(message: String = "Forbidden") = AppException(ErrorCode.FORBIDDEN, message, 403)
fun conflict(message: String) = AppException(ErrorCode.CONFLICT, message, 409)
fun validationError(message: String) = AppException(ErrorCode.VALIDATION_ERROR, message, 400)

object ErrorCode {
    const val VALIDATION_ERROR = "validation_error"
    const val INVALID_CREDENTIALS = "invalid_credentials"
    const val INVALID_CHALLENGE = "invalid_challenge"
    const val UNAUTHENTICATED = "unauthenticated"
    const val FORBIDDEN = "forbidden"
    const val NOT_FOUND = "not_found"
    const val CONFLICT = "conflict"
    const val RATE_LIMITED = "rate_limited"
    const val CSRF_BLOCKED = "csrf_blocked"
    const val RESTRICTED_SESSION = "restricted_session"
    const val STEP_UP_REQUIRED = "step_up_required"
    const val INVITE_REQUIRED = "invite_required"
    const val INVALID_INVITATION = "invalid_invitation"
    const val SETUP_CODE_REQUIRED = "setup_code_required"
    const val ACCESS_EXPIRED = "access_expired"
    const val INTERNAL = "internal_error"
}
