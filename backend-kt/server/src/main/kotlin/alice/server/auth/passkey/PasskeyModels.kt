package alice.server.auth.passkey

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The WebAuthn JSON shapes the browser and the mobile clients already speak
 * (SimpleWebAuthn's `PublicKeyCredentialCreationOptionsJSON` and
 * `PublicKeyCredentialRequestOptionsJSON`). These are ours: the verification
 * library never serialises anything to the wire.
 */

@Serializable
data class RelyingPartyEntity(val name: String, val id: String)

@Serializable
data class UserEntity(val id: String, val name: String, val displayName: String)

@Serializable
data class CredentialParameter(val type: String = "public-key", val alg: Int)

@Serializable
data class CredentialDescriptor(
    val type: String = "public-key",
    val id: String,
    val transports: List<String>? = null,
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class AuthenticatorSelection(
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val authenticatorAttachment: String? = null,
    val residentKey: String = "preferred",
    /** SimpleWebAuthn only emits this when the caller passes it; Alice does not. */
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val requireResidentKey: Boolean = true,
    val userVerification: String = "preferred",
)

@Serializable
data class RegistrationOptionsJson(
    val rp: RelyingPartyEntity,
    val user: UserEntity,
    val challenge: String,
    val pubKeyCredParams: List<CredentialParameter>,
    val timeout: Long,
    val excludeCredentials: List<CredentialDescriptor> = emptyList(),
    val authenticatorSelection: AuthenticatorSelection,
    val attestation: String = "none",
    val extensions: JsonObject = defaultRegistrationExtensions(),
    /** SimpleWebAuthn omits `hints` entirely when none are requested. */
    @OptIn(ExperimentalSerializationApi::class)
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val hints: List<String>? = null,
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class AuthenticationOptionsJson(
    val rpId: String,
    val challenge: String,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val allowCredentials: List<CredentialDescriptor>? = null,
    val timeout: Long,
    val userVerification: String = "preferred",
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val extensions: JsonObject? = null,
)

private fun defaultRegistrationExtensions(): JsonObject = buildJsonObject { put("credProps", true) }

// ---- responses sent by the client -----------------------------------------

@Serializable
data class AttestationResponseJson(
    val clientDataJSON: String,
    val attestationObject: String,
    val transports: List<String>? = null,
)

@Serializable
data class RegistrationResponseJson(
    val id: String,
    val rawId: String = "",
    val type: String = "public-key",
    val response: AttestationResponseJson,
    val authenticatorAttachment: String? = null,
    val clientExtensionResults: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class AssertionResponseJson(
    val clientDataJSON: String,
    val authenticatorData: String,
    val signature: String,
    val userHandle: String? = null,
)

@Serializable
data class AuthenticationResponseJson(
    val id: String,
    val rawId: String = "",
    val type: String = "public-key",
    val response: AssertionResponseJson,
    val authenticatorAttachment: String? = null,
    val clientExtensionResults: JsonObject = JsonObject(emptyMap()),
)

// ---- engine input/output --------------------------------------------------

data class PasskeyUser(
    /** Our user id (`usr_…`); also the WebAuthn user handle. */
    val id: String,
    /** The person's name, shown by the authenticator. */
    val displayName: String,
)

data class StartRegistrationInput(
    val user: PasskeyUser,
    /**
     * Credentials the user already has, so the browser does not offer to
     * register one twice. Yubico has no such input on `StartRegistrationOptions`
     * (it excludes by the library's "username", which is not our display name),
     * so the caller supplies them and they are rendered into the JSON only.
     */
    val excludeCredentials: List<CredentialDescriptor> = emptyList(),
)

data class StartAuthenticationInput(
    /** When set, only this user's credentials are offered (step-up). Null means discoverable sign-in. */
    val username: String? = null,
    val requireUserVerification: Boolean = false,
)

data class RegistrationOptionsResult(
    val challenge: String,
    val options: RegistrationOptionsJson,
)

data class AuthenticationOptionsResult(
    val challenge: String,
    val options: AuthenticationOptionsJson,
)

data class VerifiedRegistration(
    /** Base64url credential id. */
    val credentialId: String,
    /** Base64url COSE public key, stored as-is. */
    val publicKeyCose: String,
    val signatureCount: Long,
    val aaguid: String,
    val attestationType: String,
    val transports: List<String>,
    val backupEligible: Boolean,
    val backedUp: Boolean,
)

data class VerifiedAssertion(
    val credentialId: String,
    val signatureCount: Long,
    val userVerified: Boolean,
    val userHandle: String?,
)

/**
 * The only seam that knows about WebAuthn verification. Implementations must
 * return null (not throw) for anything that fails to verify, so the caller can
 * answer with one uniform `invalid_credentials` error.
 */
interface PasskeyEngine {
    fun startRegistration(input: StartRegistrationInput): RegistrationOptionsResult

    fun finishRegistration(
        challenge: String,
        user: PasskeyUser,
        response: RegistrationResponseJson,
    ): VerifiedRegistration?

    fun startAuthentication(input: StartAuthenticationInput): AuthenticationOptionsResult

    fun finishAuthentication(
        challenge: String,
        credentialId: String,
        requireUserVerification: Boolean,
        response: AuthenticationResponseJson,
    ): VerifiedAssertion?
}
