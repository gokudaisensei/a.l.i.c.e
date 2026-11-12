package alice.server.auth.passkey

import alice.core.db.Database
import alice.core.db.Passkeys
import alice.core.security.Base64Url
import com.yubico.webauthn.CredentialRepository
import com.yubico.webauthn.RegisteredCredential
import com.yubico.webauthn.data.AuthenticatorTransport
import com.yubico.webauthn.data.ByteArray
import com.yubico.webauthn.data.PublicKeyCredentialDescriptor
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.util.Optional

/**
 * The bridge Yubico's RelyingParty uses to look credentials up. The library's
 * "username" is Alice's user id, not the display name: the id is stable,
 * unique, and is also the WebAuthn user handle, so both directions resolve
 * without a second index.
 */
class SqlCredentialRepository(
    private val database: Database,
    private val json: Json,
) : CredentialRepository {

    override fun getCredentialIdsForUsername(username: String): Set<PublicKeyCredentialDescriptor> =
        database.read { identityQueries.selectPasskeysByUser(username).executeAsList() }
            .map { descriptor(it.id, it.transports) }
            .toSet()

    override fun getUserHandleForUsername(username: String): Optional<ByteArray> =
        database.read { identityQueries.selectUserById(username).executeAsOneOrNull() }
            ?.let { Optional.of(ByteArray(username.toByteArray())) }
            ?: Optional.empty()

    override fun getUsernameForUserHandle(userHandle: ByteArray): Optional<String> {
        val id = String(userHandle.bytes, Charsets.UTF_8)
        val exists = database.read { identityQueries.selectUserById(id).executeAsOneOrNull() } != null
        return if (exists) Optional.of(id) else Optional.empty()
    }

    override fun lookup(credentialId: ByteArray, userHandle: ByteArray): Optional<RegisteredCredential> {
        val row = database.read {
            identityQueries.selectPasskeyById(Base64Url.encode(credentialId.bytes)).executeAsOneOrNull()
        } ?: return Optional.empty()

        // A discoverable credential carries the user handle; if it is present
        // it must match the account the credential is stored under.
        if (userHandle.bytes.isNotEmpty() && !userHandle.bytes.contentEquals(row.user_id.toByteArray())) {
            return Optional.empty()
        }
        return Optional.of(registered(row))
    }

    override fun lookupAll(credentialId: ByteArray): Set<RegisteredCredential> {
        val row = database.read {
            identityQueries.selectPasskeyById(Base64Url.encode(credentialId.bytes)).executeAsOneOrNull()
        } ?: return emptySet()
        return setOf(registered(row))
    }

    private fun registered(row: Passkeys): RegisteredCredential =
        RegisteredCredential.builder()
            .credentialId(ByteArray(Base64Url.decode(row.id)))
            .userHandle(ByteArray(row.user_id.toByteArray()))
            .publicKeyCose(ByteArray(Base64Url.decode(row.public_key)))
            .signatureCount(row.counter)
            .transports(transports(row.transports))
            .build()

    private fun descriptor(id: String, transports: String?) =
        PublicKeyCredentialDescriptor.builder()
            .id(ByteArray(Base64Url.decode(id)))
            .transports(transports(transports))
            .build()

    /** The WebAuthn user handle for a credential, or null if it is unknown. */
    fun userHandleFor(credentialId: String): com.yubico.webauthn.data.ByteArray? =
        database.read { identityQueries.selectPasskeyById(credentialId).executeAsOneOrNull() }
            ?.let { com.yubico.webauthn.data.ByteArray(it.user_id.toByteArray()) }

    private fun transports(raw: String?): Set<AuthenticatorTransport> =
        if (raw.isNullOrBlank()) {
            emptySet()
        } else {
            runCatching { json.decodeFromString(ListSerializer(String.serializer()), raw) }
                .getOrDefault(emptyList())
                .mapNotNull { runCatching { AuthenticatorTransport.of(it) }.getOrNull() }
                .toSet()
        }
}
