package alice.server.auth

import alice.core.config.AppConfig
import alice.core.db.AliceDb
import alice.core.db.Database
import alice.core.db.Webauthn_challenges
import alice.core.error.AppException
import alice.core.error.ErrorCode
import alice.core.error.conflict
import alice.core.error.notFound
import alice.core.ids.Ids
import alice.core.security.Audit
import alice.core.security.Tokens
import alice.core.time.TimeProvider
import alice.server.auth.passkey.AuthenticationResponseJson
import alice.server.auth.passkey.CredentialDescriptor
import alice.server.auth.passkey.PasskeyEngine
import alice.server.auth.passkey.PasskeyUser
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.auth.passkey.StartAuthenticationInput
import alice.server.auth.passkey.StartRegistrationInput
import alice.server.auth.passkey.VerifiedRegistration
import alice.server.households.HOUR_MS
import alice.server.households.HouseholdService
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * Passkey authentication, session lifecycle and recovery codes. Semantics are
 * ported from `backend/src/modules/authentication/auth.service.ts`; the
 * cryptographic work lives behind [PasskeyEngine].
 */
class AuthService(
    private val database: Database,
    private val households: HouseholdService,
    private val engine: PasskeyEngine,
    private val config: AppConfig,
    private val time: TimeProvider,
    private val json: Json,
) {
    private val stepUpTtlMs = config.auth.stepUpTtlMinutes * MINUTE_MS
    private val challengeTtlMs = config.auth.challengeTtlMinutes * MINUTE_MS

    /**
     * The setup code in force. Mutable for one reason: a production install
     * with no users and no `SETUP_CODE` generates one at boot and logs it, so
     * the first visitor can become admin (see `Main.kt`).
     */
    var setupCode: String? = config.auth.setupCode

    // ---- challenges -------------------------------------------------------

    private fun saveChallenge(
        purpose: ChallengePurpose,
        challenge: String,
        userId: String?,
        data: ChallengeData?,
    ): String {
        val id = Ids.next("chl")
        database.write {
            identityQueries.insertChallenge(
                id = id,
                user_id = userId,
                challenge = challenge,
                purpose = purpose.wire,
                data_ = data?.let { json.encodeToString(ChallengeData.serializer(), it) },
                expires_at = time.now() + challengeTtlMs,
            )
        }
        return id
    }

    /** Single use, even if verification then fails, so a captured challenge cannot be retried. */
    private fun takeChallenge(id: String, purpose: ChallengePurpose): Webauthn_challenges =
        database.write {
            val now = time.now()
            identityQueries.takeChallenge(now, id, purpose.wire, now).executeAsOneOrNull()
                ?: throw AppException(
                    code = ErrorCode.INVALID_CHALLENGE,
                    message = "That sign-in attempt expired. Please try again",
                    status = 400,
                )
        }

    private fun challengeData(row: Webauthn_challenges): ChallengeData =
        row.data_?.let { json.decodeFromString(ChallengeData.serializer(), it) } ?: ChallengeData()

    // ---- setup ------------------------------------------------------------

    /** True until the first person has registered: the app shows "set up your home". */
    fun needsSetup(): Boolean = database.read { identityQueries.countUsers().executeAsOne() == 0L }

    fun setupCodeRequired(): Boolean = !setupCode.isNullOrBlank() && needsSetup()

    // ---- registration -----------------------------------------------------

    fun registrationOptions(input: RegistrationOptionsInput): RegistrationOptions {
        val displayName = input.displayName.trim()
        if (displayName.length !in 1..60) {
            throw AppException(ErrorCode.VALIDATION_ERROR, "Name must be 1 to 60 characters", 400)
        }
        val first = needsSetup()
        var inviteId: String? = null
        if (!first) {
            val inviteCode = input.inviteCode
            if (inviteCode.isNullOrBlank()) throw inviteRequired()
            inviteId = database.read { households.findValidInvitation(inviteCode, this) }.id
        } else {
            val setupCode = this.setupCode
            if (setupCode != null && !Tokens.constantTimeEquals(input.setupCode.orEmpty(), setupCode)) {
                throw AppException(
                    code = ErrorCode.SETUP_CODE_REQUIRED,
                    message = "Enter the setup code from the server log (or the SETUP_CODE setting)",
                    status = 403,
                )
            }
        }

        val userId = Ids.next("usr")
        val options = engine.startRegistration(StartRegistrationInput(PasskeyUser(userId, displayName)))
        val challengeId = saveChallenge(
            ChallengePurpose.REGISTER,
            options.challenge,
            userId,
            ChallengeData(displayName = displayName, inviteId = inviteId),
        )
        return RegistrationOptions(challengeId, options.options)
    }

    fun verifyRegistration(input: VerifyRegistrationInput): RegistrationSignedIn {
        val challenge = takeChallenge(input.challengeId, ChallengePurpose.REGISTER)
        val userId = challenge.user_id ?: throw unauthorized()
        val data = challengeData(challenge)
        val displayName = data.displayName ?: throw unauthorized()

        val verified = engine.finishRegistration(
            challenge = challenge.challenge,
            user = PasskeyUser(userId, displayName),
            response = input.response,
        ) ?: throw unauthorized("Could not verify the passkey")

        val now = time.now()
        return database.write {
            val first = identityQueries.countUsers().executeAsOne() == 0L
            if (!first && data.inviteId == null) throw inviteRequired()

            identityQueries.insertUser(userId, displayName, now)
            identityQueries.insertUserPreferences(userId)
            insertPasskey(this, userId, verified, input.deviceLabel, now)

            val (householdId, role) = if (first) {
                households.createHousehold(this, "Home", userId) to "admin"
            } else {
                val consumed = households.consumeInvitationById(this, data.inviteId!!, userId)
                consumed.householdId to consumed.role.wire
            }

            val codes = createRecoveryCodes(this, userId, now)
            val session = createSession(this, userId, input.userAgent, steppedUp = true, now = now)
            Audit.write(
                this,
                action = if (first) "auth.first_user_registered" else "auth.user_joined",
                householdId = householdId,
                actorId = userId,
                resource = userId,
                now = now,
            )
            RegistrationSignedIn(
                user = SignedInUser(userId, displayName),
                session = session,
                household = HouseholdRef(householdId, role),
                recoveryCodes = codes,
            )
        }
    }

    private fun insertPasskey(
        tx: AliceDb,
        userId: String,
        credential: VerifiedRegistration,
        label: String?,
        now: Long,
    ) {
        val transports = credential.transports
            .takeIf { it.isNotEmpty() }
            ?.let { json.encodeToString(ListSerializer(String.serializer()), it) }
        tx.identityQueries.insertPasskey(
            id = credential.credentialId,
            user_id = userId,
            public_key = credential.publicKeyCose,
            counter = credential.signatureCount,
            transports = transports,
            device_label = label?.take(80),
            created_at = now,
            last_used_at = null,
        )
    }

    // ---- login ------------------------------------------------------------

    fun loginOptions(): AuthenticationOptions {
        val options = engine.startAuthentication(StartAuthenticationInput())
        val challengeId = saveChallenge(ChallengePurpose.LOGIN, options.challenge, null, null)
        return AuthenticationOptions(challengeId, options.options)
    }

    fun verifyLogin(input: VerifyLoginInput): SignedIn {
        val challenge = takeChallenge(input.challengeId, ChallengePurpose.LOGIN)
        val passkey = database.read { identityQueries.selectPasskeyById(input.response.id).executeAsOneOrNull() }
            ?: throw unauthorized()

        // Per-account lockout check
        val lockout = database.read { identityQueries.selectAccountLockout(passkey.user_id).executeAsOneOrNull() }
        val lockedUntil = lockout?.locked_until
        if (lockedUntil != null && lockedUntil > time.now()) {
            throw AppException(ErrorCode.FORBIDDEN, "Account is locked. Try again later.", 403)
        }

        val verified = engine.finishAuthentication(
            challenge = challenge.challenge,
            credentialId = passkey.id,
            requireUserVerification = config.auth.requireUvAtLogin,
            response = input.response,
        )

        if (verified == null) {
            val now = time.now()
            database.write {
                val current = identityQueries.selectAccountLockout(passkey.user_id).executeAsOneOrNull()
                val count = (current?.failed_count ?: 0) + 1
                val lockedUntil = if (count >= 5) now + 15 * 60_000L else null
                identityQueries.upsertAccountLockout(passkey.user_id, count, lockedUntil, now)
            }
            throw unauthorized()
        }

        database.write { identityQueries.resetAccountLockout(passkey.user_id) }

        val now = time.now()
        database.write { identityQueries.updatePasskeyUsage(verified.signatureCount, now, passkey.id) }

        val user = database.read { identityQueries.selectUserById(passkey.user_id).executeAsOneOrNull() }
            ?: throw unauthorized()
        val membership = households.getMembership(user.id) ?: throw accessExpired()

        val session = database.write {
            createSession(this, user.id, input.userAgent, steppedUp = true, now = time.now())
        }
        return SignedIn(
            user = SignedInUser(user.id, user.display_name),
            session = session,
            household = HouseholdRef(membership.householdId, membership.role.wire),
        )
    }

    // ---- step-up ----------------------------------------------------------

    fun stepUpOptions(session: SessionContext): AuthenticationOptions {
        val options = engine.startAuthentication(
            StartAuthenticationInput(username = session.userId, requireUserVerification = true),
        )
        val challengeId = saveChallenge(
            ChallengePurpose.STEP_UP,
            options.challenge,
            session.userId,
            ChallengeData(sessionId = session.sessionId),
        )
        return AuthenticationOptions(challengeId, options.options)
    }

    fun verifyStepUp(session: SessionContext, input: VerifyLoginInput) {
        val challenge = takeChallenge(input.challengeId, ChallengePurpose.STEP_UP)
        if (challenge.user_id != session.userId || challengeData(challenge).sessionId != session.sessionId) {
            throw unauthorized()
        }
        val passkey = database.read {
            identityQueries.selectPasskeyById(input.response.id).executeAsOneOrNull()
        }?.takeIf { it.user_id == session.userId } ?: throw unauthorized()

        // Step-up must prove the user, not just the device.
        val verified = engine.finishAuthentication(
            challenge = challenge.challenge,
            credentialId = passkey.id,
            requireUserVerification = true,
            response = input.response,
        ) ?: throw unauthorized()

        val now = time.now()
        database.write {
            identityQueries.updatePasskeyUsage(verified.signatureCount, now, passkey.id)
            identityQueries.updateSessionStepUp(now, session.sessionId)
            Audit.write(this, action = "auth.step_up", actorId = session.userId, resource = session.sessionId, now = now)
        }
    }

    // ---- adding passkeys --------------------------------------------------

    fun addPasskeyOptions(session: SessionContext): RegistrationOptions {
        if (!session.restricted && !session.steppedUp) {
            throw AppException(ErrorCode.STEP_UP_REQUIRED, "Confirm with your passkey first", 403)
        }
        val user = database.read { identityQueries.selectUserById(session.userId).executeAsOneOrNull() }
            ?: throw notFound("User")
        val existing = database.read { identityQueries.selectPasskeysByUser(session.userId).executeAsList() }

        val options = engine.startRegistration(
            StartRegistrationInput(
                user = PasskeyUser(user.id, user.display_name),
                // The browser should not offer to register a passkey twice.
                excludeCredentials = existing.map { CredentialDescriptor(id = it.id) },
            ),
        )
        val challengeId = saveChallenge(
            ChallengePurpose.ADD_PASSKEY,
            options.challenge,
            session.userId,
            ChallengeData(sessionId = session.sessionId),
        )
        return RegistrationOptions(challengeId, options.options)
    }

    fun verifyAddPasskey(session: SessionContext, input: VerifyRegistrationInput) {
        val challenge = takeChallenge(input.challengeId, ChallengePurpose.ADD_PASSKEY)
        if (challenge.user_id != session.userId) throw unauthorized()

        val user = database.read { identityQueries.selectUserById(session.userId).executeAsOneOrNull() }
            ?: throw notFound("User")
        val verified = engine.finishRegistration(
            challenge = challenge.challenge,
            user = PasskeyUser(user.id, user.display_name),
            response = input.response,
        ) ?: throw unauthorized("Could not verify the passkey")

        val now = time.now()
        database.write {
            insertPasskey(this, session.userId, verified, input.deviceLabel, now)
            if (session.restricted) identityQueries.unrestrictSession(now, session.sessionId)
            Audit.write(
                this,
                action = "auth.passkey_added",
                actorId = session.userId,
                resource = verified.credentialId,
                now = now,
            )
        }
    }

    fun listPasskeys(userId: String): List<PasskeyView> =
        database.read { identityQueries.selectPasskeysByUser(userId).executeAsList() }
            .map { PasskeyView(it.id, it.device_label, it.created_at, it.last_used_at) }

    fun deletePasskey(userId: String, id: String, exceptSessionId: String? = null) {
        database.write {
            val mine = identityQueries.selectPasskeysByUser(userId).executeAsList()
            if (mine.none { it.id == id }) throw notFound("Passkey")
            if (mine.size <= 1) throw conflict("You need at least one passkey")
            identityQueries.deletePasskeyById(id)
            // Revoke all other sessions: removing a credential invalidates them
            // (L38 fix: revoke-all on credential change), except the current one.
            if (exceptSessionId != null) {
                identityQueries.revokeAllSessionsByUserExcept(time.now(), userId, exceptSessionId)
            } else {
                identityQueries.revokeAllSessionsByUser(time.now(), userId)
            }
            Audit.write(this, action = "auth.passkey_removed", actorId = userId, resource = id, now = time.now())
        }
    }

    // ---- recovery ---------------------------------------------------------

    private fun createRecoveryCodes(tx: AliceDb, userId: String, now: Long, count: Int = 10): List<String> {
        val codes = List(count) { Tokens.recoveryCode() }
        for (code in codes) {
            tx.identityQueries.insertRecoveryCode(
                id = Ids.next("rec"),
                user_id = userId,
                code_hash = households.codeHashes(code).current,
                created_at = now,
            )
        }
        return codes
    }

    /** Replaces all unused codes. Needs a fresh step-up. */
    fun regenerateRecoveryCodes(session: SessionContext): List<String> {
        if (!session.steppedUp) {
            throw AppException(ErrorCode.STEP_UP_REQUIRED, "Confirm with your passkey first", 403)
        }
        val now = time.now()
        return database.write {
            identityQueries.deleteUnusedRecoveryCodes(session.userId)
            identityQueries.revokeAllSessionsByUserExcept(now, session.userId, session.sessionId)
            // Re-create the current session since we just revoked all
            Audit.write(this, action = "auth.recovery_codes_regenerated", actorId = session.userId, now = now)
            createRecoveryCodes(this, session.userId, now)
        }
    }

    /** A recovery code opens a restricted session that can only add a new passkey. */
    fun recoveryLogin(code: String, userAgent: String?): SignedIn {
        val now = time.now()
        val row = database.write {
            val hashes = households.codeHashes(code)
            identityQueries.consumeRecoveryCode(now, hashes.current).executeAsOneOrNull()
                ?: identityQueries.consumeRecoveryCode(now, hashes.legacy).executeAsOneOrNull()
        } ?: throw unauthorized("That recovery code is not valid")

        val user = database.read { identityQueries.selectUserById(row.user_id).executeAsOneOrNull() }
            ?: throw unauthorized()
        val membership = households.getMembership(user.id) ?: throw accessExpired()

        val session = database.write {
            Audit.write(
                this,
                action = "auth.recovery_used",
                householdId = membership.householdId,
                actorId = user.id,
                now = now,
            )
            createSession(this, user.id, userAgent, restricted = true, now = now)
        }
        return SignedIn(
            user = SignedInUser(user.id, user.display_name),
            session = session,
            household = HouseholdRef(membership.householdId, membership.role.wire),
        )
    }

    // ---- sessions ---------------------------------------------------------

    private fun createSession(
        tx: AliceDb,
        userId: String,
        userAgent: String?,
        steppedUp: Boolean = false,
        restricted: Boolean = false,
        now: Long = time.now(),
    ): SessionToken {
        val token = Tokens.randomToken()
        val expiresAt = now + config.auth.sessionTtlHours * HOUR_MS
        tx.identityQueries.insertSession(
            id = Ids.next("ses"),
            user_id = userId,
            token_hash = Tokens.sha256(token),
            created_at = now,
            expires_at = expiresAt,
            last_seen_at = now,
            user_agent = userAgent?.take(200),
            last_step_up_at = if (steppedUp) now else null,
            restricted = if (restricted) 1 else 0,
        )
        return SessionToken(token, expiresAt)
    }

    /** Resolves a session token, or null if unknown, revoked or expired. */
    fun getSession(token: String?): SessionContext? {
        if (token.isNullOrBlank()) return null
        return database.write {
            val row = identityQueries.selectSessionByTokenHash(Tokens.sha256(token)).executeAsOneOrNull()
                ?: return@write null
            val now = time.now()
            if (row.revoked_at != null || row.expires_at <= now) return@write null

            if (now - row.last_seen_at > 60_000) {
                identityQueries.updateSessionLastSeen(now, row.id)
            }

            // Sliding expiry: once more than half the time is used, an active
            // session is pushed out again, up to the 90-day cap. A recovery
            // session is never renewed: it exists only to add a passkey.
            var expiresAt = row.expires_at
            var renewedUntil: Long? = null
            val ttl = config.auth.sessionTtlHours * HOUR_MS
            if (row.restricted == 0L && row.expires_at - now < ttl / 2) {
                val next = minOf(now + ttl, row.created_at + MAX_SESSION_AGE_HOURS * HOUR_MS)
                if (next > row.expires_at + 60_000) {
                    identityQueries.updateSessionExpiry(next, row.id)
                    expiresAt = next
                    renewedUntil = next
                }
            }

            SessionContext(
                sessionId = row.id,
                userId = row.user_id,
                expiresAt = expiresAt,
                steppedUp = row.last_step_up_at?.let { now - it < stepUpTtlMs } ?: false,
                restricted = row.restricted != 0L,
                renewedUntil = renewedUntil,
            )
        }
    }

    /** Long-lived sockets re-check this rather than trusting the cookie forever. */
    fun isSessionActive(sessionId: String): Boolean = database.read {
        identityQueries.selectSessionById(sessionId).executeAsOneOrNull()
    }.let { row -> row != null && row.revoked_at == null && row.expires_at > time.now() }

    fun logout(sessionId: String) {
        database.write { identityQueries.revokeSessionById(time.now(), sessionId) }
    }

    fun listSessions(userId: String): List<SessionView> =
        database.read { identityQueries.selectActiveSessionsByUser(userId, time.now()).executeAsList() }
            .map { SessionView(it.id, it.created_at, it.last_seen_at, it.expires_at, it.user_agent) }

    fun revokeSession(userId: String, id: String) {
        database.write {
            val row = identityQueries.selectSessionById(id).executeAsOneOrNull()
            if (row == null || row.user_id != userId || row.revoked_at != null) throw notFound("Session")
            identityQueries.revokeSessionById(time.now(), id)
        }
    }

    // ---- errors -----------------------------------------------------------

    private fun unauthorized(message: String = "Authentication failed") =
        AppException(ErrorCode.INVALID_CREDENTIALS, message, 401)

    private fun inviteRequired() =
        AppException(ErrorCode.INVITE_REQUIRED, "You need an invitation to join this home", 403)

    private fun accessExpired() =
        AppException(ErrorCode.ACCESS_EXPIRED, "Your access to this home has ended", 403)

    private companion object {
        const val MINUTE_MS = 60_000L
        /** A session that keeps being used is renewed, but never lives longer than this in all. */
        const val MAX_SESSION_AGE_HOURS = 90 * 24L
    }
}

// Request shapes kept next to the service so controller tests do not depend on
// HTTP DTOs.
data class RegistrationOptionsInput(
    val displayName: String,
    val inviteCode: String? = null,
    val setupCode: String? = null,
)

data class VerifyRegistrationInput(
    val challengeId: String,
    val response: RegistrationResponseJson,
    val deviceLabel: String? = null,
    val userAgent: String? = null,
)

data class VerifyLoginInput(
    val challengeId: String,
    val response: AuthenticationResponseJson,
    val userAgent: String? = null,
)

data class RegistrationOptions(
    val challengeId: String,
    val options: alice.server.auth.passkey.RegistrationOptionsJson,
)

data class AuthenticationOptions(
    val challengeId: String,
    val options: alice.server.auth.passkey.AuthenticationOptionsJson,
)
