package alice.server.auth.passkey

import alice.core.config.AppConfig
import alice.core.security.Base64Url
import com.yubico.webauthn.AssertionRequest
import com.yubico.webauthn.CredentialRepository
import com.yubico.webauthn.FinishAssertionOptions
import com.yubico.webauthn.FinishRegistrationOptions
import com.yubico.webauthn.RegistrationResult
import com.yubico.webauthn.RelyingParty
import com.yubico.webauthn.StartAssertionOptions
import com.yubico.webauthn.StartRegistrationOptions
import com.yubico.webauthn.data.AttestationConveyancePreference
import com.yubico.webauthn.data.AuthenticatorAssertionResponse
import com.yubico.webauthn.data.AuthenticatorAttachment
import com.yubico.webauthn.data.AuthenticatorAttestationResponse
import com.yubico.webauthn.data.AuthenticatorSelectionCriteria
import com.yubico.webauthn.data.AuthenticatorTransport
import com.yubico.webauthn.data.ByteArray as YubicoByteArray
import com.yubico.webauthn.data.ClientAssertionExtensionOutputs
import com.yubico.webauthn.data.ClientRegistrationExtensionOutputs
import com.yubico.webauthn.data.PublicKeyCredential
import com.yubico.webauthn.data.PublicKeyCredentialCreationOptions
import com.yubico.webauthn.data.PublicKeyCredentialDescriptor
import com.yubico.webauthn.data.PublicKeyCredentialParameters
import com.yubico.webauthn.data.PublicKeyCredentialRequestOptions
import com.yubico.webauthn.data.RegistrationExtensionInputs
import com.yubico.webauthn.data.RelyingPartyIdentity as YubicoRelyingPartyIdentity
import com.yubico.webauthn.data.ResidentKeyRequirement
import com.yubico.webauthn.data.UserIdentity as YubicoUserIdentity
import com.yubico.webauthn.data.UserVerificationRequirement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory
import java.time.Clock

/**
 * WebAuthn via Yubico's reference implementation (`webauthn-server-core`).
 *
 * The library is used strictly as a verifier: we hand it raw bytes from our
 * own kotlinx-serialization DTOs and read primitive fields back out. Its
 * Jackson-backed `toJson`/`parse*Json` helpers are never called, so Jackson
 * is not on the wire path (it remains a transitive runtime dependency).
 *
 * This class is the only place that imports `com.yubico.*`.
 */
class YubicoPasskeyEngine(
    config: AppConfig,
    private val credentialRepository: SqlCredentialRepository,
    clock: Clock = Clock.systemUTC(),
) : PasskeyEngine {

    private val log = LoggerFactory.getLogger("alice.auth.passkey")

    private val identity = YubicoRelyingPartyIdentity.builder()
        .id(config.webauthn.rpId)
        .name(config.webauthn.rpName)
        .build()

    private val relyingParty = RelyingParty.builder()
        .identity(identity)
        .credentialRepository(credentialRepository)
        .origins(setOf(config.webauthn.origin) + config.webauthn.extraOrigins)
        // Passkeys use `none`; a self/basic attestation without a trusted root
        // is normal and must still register.
        .allowUntrustedAttestation(config.auth.allowUntrustedAttestation)
        .attestationConveyancePreference(AttestationConveyancePreference.NONE)
        // SimpleWebAuthn's default preference order, so clients see the same
        // algorithms from either backend.
        .preferredPubkeyParams(listOf(PublicKeyCredentialParameters.EdDSA, PublicKeyCredentialParameters.ES256, PublicKeyCredentialParameters.RS256))
        // A counter that goes backwards is a cloned authenticator. Zero is
        // treated as "not supported" by the library.
        .validateSignatureCounter(true)
        .clock(clock)
        .build()

    private val aaguidAllowlist = config.auth.aaguidAllowlist.map { it.lowercase() }

    // ---- registration -----------------------------------------------------

    override fun startRegistration(input: StartRegistrationInput): RegistrationOptionsResult {
        val user = userIdentity(input.user)
        val options = relyingParty.startRegistration(
            StartRegistrationOptions.builder()
                .user(user)
                .timeout(PROMPT_TIMEOUT_MS)
                .authenticatorSelection(registrationSelection())
                .extensions(RegistrationExtensionInputs.builder().credProps().build())
                .build(),
        )
        return RegistrationOptionsResult(
            challenge = options.challenge.base64Url(),
            options = RegistrationOptionsJson(
                rp = RelyingPartyEntity(name = identity.name, id = identity.id),
                user = UserEntity(
                    id = options.user.id.base64Url(),
                    name = options.user.name,
                    displayName = options.user.displayName,
                ),
                challenge = options.challenge.base64Url(),
                pubKeyCredParams = options.pubKeyCredParams.map {
                    CredentialParameter(type = it.type.id, alg = it.alg.id.toInt())
                },
                timeout = options.timeout.orElse(PROMPT_TIMEOUT_MS),
                excludeCredentials = input.excludeCredentials,
                authenticatorSelection = AuthenticatorSelection(
                    authenticatorAttachment = options.authenticatorSelection
                        .flatMap { it.authenticatorAttachment }
                        .map { it.value }
                        .orElse(null),
                    residentKey = options.authenticatorSelection
                        .flatMap { it.residentKey }
                        .map { it.value }
                        .orElse(ResidentKeyRequirement.REQUIRED.value),
                    requireResidentKey = options.authenticatorSelection
                        .flatMap { it.residentKey }
                        .map { it == ResidentKeyRequirement.REQUIRED }
                        .orElse(true),
                    userVerification = options.authenticatorSelection
                        .flatMap { it.userVerification }
                        .map { it.value }
                        .orElse(UserVerificationRequirement.PREFERRED.value),
                ),
                attestation = "none",
                extensions = buildJsonObject { put("credProps", true) },
                hints = options.hints.takeIf { it.isNotEmpty() },
            ),
        )
    }

    override fun finishRegistration(
        challenge: String,
        user: PasskeyUser,
        response: RegistrationResponseJson,
    ): VerifiedRegistration? = try {
        val request = PublicKeyCredentialCreationOptions.builder()
            .rp(identity)
            .user(userIdentity(user))
            .challenge(decode(challenge))
            .pubKeyCredParams(listOf(PublicKeyCredentialParameters.EdDSA, PublicKeyCredentialParameters.ES256, PublicKeyCredentialParameters.RS256))
            .timeout(PROMPT_TIMEOUT_MS)
            .attestation(AttestationConveyancePreference.NONE)
            .authenticatorSelection(registrationSelection())
            .extensions(RegistrationExtensionInputs.builder().credProps().build())
            .build()

        val attestationResponse = AuthenticatorAttestationResponse.builder()
            .attestationObject(decode(response.response.attestationObject))
            .clientDataJSON(decode(response.response.clientDataJSON))
            .transports(transportSet(response.response.transports))
            .build()

        val credential = PublicKeyCredential.builder<AuthenticatorAttestationResponse, ClientRegistrationExtensionOutputs>()
            .id(decode(response.id))
            .response(attestationResponse)
            .clientExtensionResults(ClientRegistrationExtensionOutputs.builder().build())
            .build()

        val result = relyingParty.finishRegistration(
            FinishRegistrationOptions.builder().request(request).response(credential).build(),
        )
        if (!result.isAttestationAllowed()) return null
        result.toVerified(response.response.transports.orEmpty())
    } catch (e: Exception) {
        log.debug("verification failed", e)
        null
    }

    // ---- authentication ---------------------------------------------------

    override fun startAuthentication(input: StartAuthenticationInput): AuthenticationOptionsResult {
        val builder = StartAssertionOptions.builder()
            .timeout(PROMPT_TIMEOUT_MS)
            .userVerification(
                if (input.requireUserVerification) UserVerificationRequirement.REQUIRED
                else UserVerificationRequirement.PREFERRED,
            )
        input.username?.let { builder.username(it) }

        val request = relyingParty.startAssertion(builder.build())
        val options = request.publicKeyCredentialRequestOptions
        return AuthenticationOptionsResult(
            challenge = options.challenge.base64Url(),
            options = AuthenticationOptionsJson(
                rpId = options.rpId,
                challenge = options.challenge.base64Url(),
                allowCredentials = options.allowCredentials.orElse(null)
                    ?.takeIf { it.isNotEmpty() }
                    ?.map(::descriptorDto),
                timeout = options.timeout.orElse(PROMPT_TIMEOUT_MS),
                userVerification = options.userVerification
                    .orElse(UserVerificationRequirement.PREFERRED)
                    .value,
            ),
        )
    }

    override fun finishAuthentication(
        challenge: String,
        credentialId: String,
        requireUserVerification: Boolean,
        response: AuthenticationResponseJson,
    ): VerifiedAssertion? = try {
        val requestOptions = PublicKeyCredentialRequestOptions.builder()
            .challenge(decode(challenge))
            .rpId(identity.id)
            .timeout(PROMPT_TIMEOUT_MS)
            .userVerification(
                if (requireUserVerification) UserVerificationRequirement.REQUIRED
                else UserVerificationRequirement.PREFERRED,
            )
            .build()
        // Discoverable sign-in: Yubico needs *some* way to find the user. The
        // credential store already knows who owns this credential, so hand it
        // the handle rather than relying on the browser to send one.
        val userHandle = credentialRepository.userHandleFor(credentialId)
        val assertionRequestBuilder = AssertionRequest.builder()
            .publicKeyCredentialRequestOptions(requestOptions)
        userHandle?.let { assertionRequestBuilder.userHandle(it) }
        val request = assertionRequestBuilder.build()

        val assertionResponseBuilder = AuthenticatorAssertionResponse.builder()
            .authenticatorData(decode(response.response.authenticatorData))
            .clientDataJSON(decode(response.response.clientDataJSON))
            .signature(decode(response.response.signature))
        response.response.userHandle?.takeIf { it.isNotBlank() }?.let {
            assertionResponseBuilder.userHandle(decode(it))
        }

        val credential = PublicKeyCredential.builder<AuthenticatorAssertionResponse, ClientAssertionExtensionOutputs>()
            .id(decode(response.id))
            .response(assertionResponseBuilder.build())
            .clientExtensionResults(ClientAssertionExtensionOutputs.builder().build())
            .build()

        val result = relyingParty.finishAssertion(
            FinishAssertionOptions.builder().request(request).response(credential).build(),
        )
        if (!result.isSuccess()) return null
        // The caller already checked that the response id belongs to the
        // expected account; make sure the verifier saw the same credential.
        if (result.credential.credentialId.base64Url() != credentialId) return null
        VerifiedAssertion(
            credentialId = result.credential.credentialId.base64Url(),
            signatureCount = result.signatureCount,
            userVerified = result.isUserVerified,
            userHandle = result.credential.userHandle.base64Url(),
        )
    } catch (e: Exception) {
        log.debug("verification failed", e)
        null
    }

    // ---- helpers ----------------------------------------------------------

    private fun userIdentity(user: PasskeyUser): YubicoUserIdentity =
        YubicoUserIdentity.builder()
            .name(user.displayName)
            .displayName(user.displayName)
            .id(decode(Base64Url.encode(user.id.toByteArray())))
            .build()

    private fun registrationSelection(): AuthenticatorSelectionCriteria =
        AuthenticatorSelectionCriteria.builder()
            .residentKey(ResidentKeyRequirement.REQUIRED)
            .userVerification(UserVerificationRequirement.PREFERRED)
            .build()

    private fun RegistrationResult.isAttestationAllowed(): Boolean {
        if (aaguidAllowlist.isEmpty()) return true
        val aaguid = aaguidHex()
        return aaguid in aaguidAllowlist
    }

    private fun RegistrationResult.toVerified(transports: List<String>): VerifiedRegistration =
        VerifiedRegistration(
            credentialId = keyId.id.base64Url(),
            publicKeyCose = publicKeyCose.base64Url(),
            signatureCount = signatureCount,
            aaguid = aaguidHex(),
            attestationType = attestationType.name.lowercase(),
            transports = keyId.transports
                .map { set -> set.map { it.id } }
                .orElse(transports),
            backupEligible = isBackupEligible,
            backedUp = isBackedUp,
        )

    private fun RegistrationResult.aaguidHex(): String {
        val hex = aaguid.bytes.joinToString("") { "%02x".format(it) }
        return if (hex.length == 32) {
            "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
        } else {
            hex
        }
    }

    private fun descriptorDto(descriptor: PublicKeyCredentialDescriptor): CredentialDescriptor =
        CredentialDescriptor(
            type = descriptor.type.id,
            id = descriptor.id.base64Url(),
            transports = descriptor.transports.map { set -> set.map { it.id } }.orElse(null),
        )

    private fun YubicoByteArray.base64Url(): String = Base64Url.encode(bytes)

    private fun decode(value: String): YubicoByteArray = YubicoByteArray(Base64Url.decode(value))

    private fun transportSet(values: List<String>?): Set<AuthenticatorTransport> =
        values.orEmpty()
            .mapNotNull { runCatching { AuthenticatorTransport.of(it) }.getOrNull() }
            .toSet()

    private companion object {
        /** How long the browser waits for a passkey; scanning a phone takes longer than the 60 s default. */
        const val PROMPT_TIMEOUT_MS = 5 * 60_000L
    }
}
