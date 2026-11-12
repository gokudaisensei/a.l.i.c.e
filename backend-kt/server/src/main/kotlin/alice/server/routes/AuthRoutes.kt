package alice.server.routes

import alice.core.config.AppConfig
import alice.core.error.validationError
import alice.core.http.Limits
import alice.core.http.enforce
import alice.server.auth.AuthService
import alice.server.auth.AuthenticationOptions
import alice.server.auth.HouseholdRef
import alice.server.auth.PasskeyView
import alice.server.auth.RegistrationOptions
import alice.server.auth.RegistrationOptionsInput
import alice.server.auth.SignedInUser
import alice.server.auth.VerifyLoginInput
import alice.server.auth.VerifyRegistrationInput
import alice.server.auth.passkey.AuthenticationOptionsJson
import alice.server.auth.passkey.AuthenticationResponseJson
import alice.server.auth.passkey.RegistrationOptionsJson
import alice.server.auth.passkey.RegistrationResponseJson
import alice.server.http.Guards
import alice.server.http.expiredSessionCookie
import alice.server.http.requestAuth
import alice.server.http.sessionCookie
import io.ktor.http.HttpHeaders
import io.ktor.server.application.ApplicationCall
import io.ktor.server.plugins.origin
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.route
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

/**
 * The authentication routes (`/api/v1/auth/…`), the only public surface
 * besides `/health`. Shapes and status codes match
 * `backend/src/modules/authentication/auth.controller.ts`.
 */
fun Route.authRoutes(auth: AuthService, limits: Limits, config: AppConfig) {
    route("/api/v1/auth") {

        get("/setup") {
            call.throttle(limits, config)
            call.respond(SetupResponse(auth.needsSetup(), auth.setupCodeRequired()))
        }

        // ---- registration -------------------------------------------------

        post("/register/options") {
            val body = call.receive<RegisterOptionsBody>()
            call.throttle(
                limits = limits,
                config = config,
                secret = !body.inviteCode.isNullOrBlank() || auth.setupCodeRequired(),
            )
            val result = blocking {
                auth.registrationOptions(
                    RegistrationOptionsInput(body.displayName, body.inviteCode, body.setupCode),
                )
            }
            call.respond(result.toResponse())
        }

        post("/register/verify") {
            val body = call.receive<RegisterVerifyBody>()
            call.throttle(limits, config)
            val result = blocking {
                auth.verifyRegistration(
                    VerifyRegistrationInput(
                        challengeId = body.challengeId,
                        response = body.response,
                        deviceLabel = body.deviceLabel,
                        userAgent = call.request.headers[HttpHeaders.UserAgent],
                    ),
                )
            }
            call.response.cookies.append(sessionCookie(result.session.token, result.session.expiresAt, config.secureCookies))
            call.respond(
                RegistrationResponse(
                    user = result.user,
                    household = result.household,
                    expiresAt = result.session.expiresAt,
                    recoveryCodes = result.recoveryCodes,
                ),
            )
        }

        // ---- login --------------------------------------------------------

        post("/login/options") {
            call.throttle(limits, config)
            call.respond(blocking { auth.loginOptions().toResponse() })
        }

        post("/login/verify") {
            val body = call.receive<LoginVerifyBody>()
            call.throttle(limits, config)
            val result = blocking {
                auth.verifyLogin(
                    VerifyLoginInput(
                        challengeId = body.challengeId,
                        response = body.response,
                        userAgent = call.request.headers[HttpHeaders.UserAgent],
                    ),
                )
            }
            call.response.cookies.append(sessionCookie(result.session.token, result.session.expiresAt, config.secureCookies))
            call.respond(SignedInResponse(result.user, result.household, result.session.expiresAt))
        }

        post("/logout") {
            val session = Guards.requireSession(call.requestAuth(), allowRestricted = true)
            blocking { auth.logout(session.sessionId) }
            call.response.cookies.append(expiredSessionCookie(config.secureCookies))
            call.respond(OkResponse())
        }

        get("/session") {
            val authContext = call.requestAuth()
            val session = Guards.requireSession(authContext, allowRestricted = true)
            val membership = authContext.membership
            call.respond(
                SessionResponse(
                    userId = session.userId,
                    expiresAt = session.expiresAt,
                    steppedUp = session.steppedUp,
                    restricted = session.restricted,
                    household = membership?.let {
                        SessionHousehold(it.householdId, it.role.wire, it.expiresAt)
                    },
                ),
            )
        }

        // ---- sessions -----------------------------------------------------

        get("/sessions") {
            val session = Guards.requireSession(call.requestAuth())
            val sessions = blocking { auth.listSessions(session.userId) }
            call.respond(
                SessionsResponse(
                    sessions.map {
                        SessionItem(
                            id = it.id,
                            createdAt = it.createdAt,
                            lastSeenAt = it.lastSeenAt,
                            expiresAt = it.expiresAt,
                            userAgent = it.userAgent,
                            current = it.id == session.sessionId,
                        )
                    },
                ),
            )
        }

        delete("/sessions/{id}") {
            val session = Guards.requireSession(call.requestAuth())
            val id = call.parameters["id"] ?: throw validationError("Session id is required")
            blocking { auth.revokeSession(session.userId, id) }
            call.respond(OkResponse())
        }

        // ---- step-up ------------------------------------------------------

        post("/step-up/options") {
            val session = Guards.requireSession(call.requestAuth())
            call.respond(blocking { auth.stepUpOptions(session).toResponse() })
        }

        post("/step-up/verify") {
            val session = Guards.requireSession(call.requestAuth())
            val body = call.receive<LoginVerifyBody>()
            blocking {
                auth.verifyStepUp(session, VerifyLoginInput(body.challengeId, body.response))
            }
            call.respond(SteppedUpResponse())
        }

        // ---- passkeys -----------------------------------------------------

        get("/passkeys") {
            val session = Guards.requireSession(call.requestAuth(), allowRestricted = true)
            call.respond(PasskeysResponse(blocking { auth.listPasskeys(session.userId) }))
        }

        post("/passkeys/options") {
            val session = Guards.requireSession(call.requestAuth(), allowRestricted = true)
            call.respond(blocking { auth.addPasskeyOptions(session).toResponse() })
        }

        post("/passkeys/verify") {
            val session = Guards.requireSession(call.requestAuth(), allowRestricted = true)
            val body = call.receive<RegisterVerifyBody>()
            blocking {
                auth.verifyAddPasskey(
                    session,
                    VerifyRegistrationInput(
                        challengeId = body.challengeId,
                        response = body.response,
                        deviceLabel = body.deviceLabel,
                    ),
                )
            }
            call.respond(OkResponse())
        }

        delete("/passkeys/{id}") {
            val session = Guards.requireSession(call.requestAuth())
            Guards.requireStepUp(session)
            val id = call.parameters["id"] ?: throw validationError("Passkey id is required")
            blocking { auth.deletePasskey(session.userId, id, session.sessionId) }
            call.respond(OkResponse())
        }

        // ---- recovery -----------------------------------------------------

        post("/recovery/verify") {
            val body = call.receive<RecoveryBody>()
            call.throttle(limits, config, secret = true)
            val result = blocking {
                auth.recoveryLogin(body.code, call.request.headers[HttpHeaders.UserAgent])
            }
            call.response.cookies.append(sessionCookie(result.session.token, result.session.expiresAt, config.secureCookies))
            call.respond(
                RecoveryResponse(result.user, result.household, result.session.expiresAt, restricted = true),
            )
        }

        post("/recovery/regenerate") {
            val member = Guards.requireMember(call.requestAuth())
            call.respond(RecoveryCodesResponse(blocking { auth.regenerateRecoveryCodes(member.session) }))
        }
    }
}

// ---- request/response shapes ---------------------------------------------

@Serializable
data class SetupResponse(val needsSetup: Boolean, val setupCodeRequired: Boolean)

@Serializable
data class RegisterOptionsBody(
    val displayName: String,
    val inviteCode: String? = null,
    val setupCode: String? = null,
)

@Serializable
data class RegisterVerifyBody(
    val challengeId: String,
    val response: RegistrationResponseJson,
    val deviceLabel: String? = null,
)

@Serializable
data class LoginVerifyBody(
    val challengeId: String,
    val response: AuthenticationResponseJson,
)

@Serializable
data class RecoveryBody(val code: String)

@Serializable
data class RegistrationOptionsResponse(
    val challengeId: String,
    val options: RegistrationOptionsJson,
)

@Serializable
data class AuthenticationOptionsResponse(
    val challengeId: String,
    val options: AuthenticationOptionsJson,
)

@Serializable
data class SignedInResponse(
    val user: SignedInUser,
    val household: HouseholdRef?,
    val expiresAt: Long,
)

@Serializable
data class RegistrationResponse(
    val user: SignedInUser,
    val household: HouseholdRef,
    val expiresAt: Long,
    val recoveryCodes: List<String>,
)

@Serializable
data class RecoveryResponse(
    val user: SignedInUser,
    val household: HouseholdRef?,
    val expiresAt: Long,
    val restricted: Boolean,
)

@Serializable
data class SessionHousehold(val id: String, val role: String, val expiresAt: Long?)

@Serializable
data class SessionResponse(
    val userId: String,
    val expiresAt: Long,
    val steppedUp: Boolean,
    val restricted: Boolean,
    val household: SessionHousehold?,
)

@Serializable
data class SessionItem(
    val id: String,
    val createdAt: Long,
    val lastSeenAt: Long,
    val expiresAt: Long,
    val userAgent: String?,
    val current: Boolean,
)

@Serializable
data class SessionsResponse(val sessions: List<SessionItem>)

@Serializable
data class PasskeysResponse(val passkeys: List<PasskeyView>)

@Serializable
data class OkResponse(val ok: Boolean = true)

@Serializable
data class SteppedUpResponse(val steppedUp: Boolean = true)

@Serializable
data class RecoveryCodesResponse(val recoveryCodes: List<String>)

// ---- helpers --------------------------------------------------------------

private fun RegistrationOptions.toResponse() =
    RegistrationOptionsResponse(challengeId, options)

private fun AuthenticationOptions.toResponse() =
    AuthenticationOptionsResponse(challengeId, options)

/**
 * The engine and SQLite calls are blocking. Moving them off the event loop
 * keeps a slow signature check from stalling other requests.
 */
private suspend fun <T> blocking(block: () -> T): T = withContext(Dispatchers.IO) { block() }

/** Per-IP limit on every public auth call; `secret` adds the strict code-guessing limits. */
private fun ApplicationCall.throttle(limits: Limits, config: AppConfig, secret: Boolean = false) {
    val ip = clientIp(this, config.http.trustProxy)
    enforce(limits.auth, ip)
    if (secret) {
        enforce(limits.secrets, ip)
        enforce(limits.secretsGlobal, "all")
    }
}

/** Forwarded headers are only trusted behind a proxy you control (`TRUST_PROXY=true`). */
private fun clientIp(call: ApplicationCall, trustProxy: Boolean): String {
    if (trustProxy) {
        forwardedClientIp(call.request.headers[HttpHeaders.XForwardedFor])?.let { return it }
    }
    return call.request.origin.remoteAddress
}

/** The last entry is the one our own proxy appended; earlier entries are whatever the client claimed. */
internal fun forwardedClientIp(header: String?): String? =
    header?.split(',')?.lastOrNull()?.trim()?.takeIf { it.isNotEmpty() }
