package alice.server.http

import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.server.auth.SessionContext
import alice.server.households.Membership
import io.ktor.server.application.ApplicationCall
import io.ktor.util.AttributeKey

/** What the session plugin resolved for this request. */
data class RequestAuth(
    val session: SessionContext?,
    val membership: Membership?,
)

val RequestAuthKey = AttributeKey<RequestAuth>("alice.requestAuth")

fun ApplicationCall.requestAuth(): RequestAuth =
    attributes.getOrNull(RequestAuthKey) ?: RequestAuth(null, null)

data class MemberContext(
    val session: SessionContext,
    val membership: Membership,
)

object Guards {

    /** A signed-in session. Recovery sessions are refused unless a route opts in. */
    fun requireSession(auth: RequestAuth, allowRestricted: Boolean = false): SessionContext {
        val session = auth.session
            ?: throw AppException(ErrorCode.UNAUTHENTICATED, "Please sign in", 401)
        if (session.restricted && !allowRestricted) {
            throw AppException(
                code = ErrorCode.RESTRICTED_SESSION,
                message = "Add a new passkey to finish recovering your account",
                status = 403,
            )
        }
        return session
    }

    /** A signed-in session whose user currently belongs to a household. */
    fun requireMember(auth: RequestAuth): MemberContext {
        val session = requireSession(auth)
        val membership = auth.membership
            ?: throw AppException(ErrorCode.ACCESS_EXPIRED, "You do not have access to a home", 403)
        return MemberContext(session, membership)
    }

    /** A signed-in session whose user has the given permission in their household. */
    fun requirePermission(auth: RequestAuth, permission: String): MemberContext {
        val member = requireMember(auth)
        if (!alice.server.permissions.can(member.membership.role, permission)) {
            throw AppException(ErrorCode.FORBIDDEN, "You do not have permission to do that", 403)
        }
        return member
    }

    /** Sensitive actions need a passkey assertion from the last few minutes. */
    fun requireStepUp(session: SessionContext) {
        if (!session.steppedUp) {
            throw AppException(ErrorCode.STEP_UP_REQUIRED, "Confirm with your passkey to continue", 403)
        }
    }
}
