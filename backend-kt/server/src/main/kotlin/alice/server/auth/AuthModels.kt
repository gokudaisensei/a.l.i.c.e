package alice.server.auth

import kotlinx.serialization.Serializable

enum class ChallengePurpose(val wire: String) {
    REGISTER("register"),
    LOGIN("login"),
    STEP_UP("step_up"),
    ADD_PASSKEY("add_passkey"),
}

/** Context carried from the options call to the verify call. */
@Serializable
data class ChallengeData(
    val displayName: String? = null,
    /** The invitation this registration was started with; the code itself is never stored. */
    val inviteId: String? = null,
    val sessionId: String? = null,
)

data class SessionToken(val token: String, val expiresAt: Long)

@Serializable
data class SignedInUser(val id: String, val displayName: String)

@Serializable
data class HouseholdRef(val id: String, val role: String)

data class SignedIn(
    val user: SignedInUser,
    val session: SessionToken,
    val household: HouseholdRef?,
)

data class RegistrationSignedIn(
    val user: SignedInUser,
    val session: SessionToken,
    val household: HouseholdRef,
    val recoveryCodes: List<String>,
)

data class SessionContext(
    val sessionId: String,
    val userId: String,
    val expiresAt: Long,
    val steppedUp: Boolean,
    /** Recovery sessions can only add a passkey. */
    val restricted: Boolean,
    /** Set when this request renewed the session: the cookie must be refreshed to match. */
    val renewedUntil: Long? = null,
)

@Serializable
data class PasskeyView(
    val id: String,
    val deviceLabel: String?,
    val createdAt: Long,
    val lastUsedAt: Long?,
)

@Serializable
data class SessionView(
    val id: String,
    val createdAt: Long,
    val lastSeenAt: Long,
    val expiresAt: Long,
    val userAgent: String?,
)
