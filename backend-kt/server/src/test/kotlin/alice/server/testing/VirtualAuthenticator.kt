package alice.server.testing

import alice.core.security.Base64Url
import alice.server.auth.passkey.AttestationResponseJson
import alice.server.auth.passkey.AuthenticationResponseJson
import alice.server.auth.passkey.AssertionResponseJson
import alice.server.auth.passkey.RegistrationResponseJson
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import kotlinx.serialization.json.JsonObject

/**
 * A software passkey for tests: creates ES256 credentials and signs challenges
 * exactly as a browser authenticator would, so the real verification path of
 * the WebAuthn engine is exercised end to end.
 *
 * Ported from `backend/src/modules/authentication/testing/virtual-authenticator.ts`.
 */
class VirtualAuthenticator(
    private val rpId: String,
    private val origin: String,
) {
    private class Credential(
        val privateKey: PrivateKey,
        val publicKey: ECPublicKey,
        var counter: Int,
    )

    private val credentials = LinkedHashMap<String, Credential>()
    private val random = SecureRandom()

    /** The most recently created credential id. */
    var lastCredentialId: String = ""

    fun create(challenge: String, originOverride: String? = null): RegistrationResponseJson {
        val keyPair = KeyPairGenerator.getInstance("EC")
            .apply { initialize(ECGenParameterSpec("secp256r1")) }
            .generateKeyPair()
        val publicKey = keyPair.public as ECPublicKey
        val credentialId = randomBytes(16)
        val id = Base64Url.encode(credentialId)
        credentials[id] = Credential(keyPair.private, publicKey, 0)
        lastCredentialId = id

        val authData = buildByteArray {
            append(sha256(rpId.toByteArray()))
            // UP | UV | AT
            append(0x45)
            append(0); append(0); append(0); append(0)
            // aaguid (16 bytes)
            repeat(16) { append(0) }
            append(credentialId.size shr 8)
            append(credentialId.size and 0xff)
            append(credentialId)
            append(coseKey(publicKey))
        }

        val attestationObject = cborMap(
            linkedMapOf<Any, Any>(
                "fmt" to "none",
                "attStmt" to emptyMap<String, String>(),
                "authData" to authData,
            ),
        )
        val clientData = clientDataJson("webauthn.create", challenge, originOverride ?: origin)

        return RegistrationResponseJson(
            id = id,
            response = AttestationResponseJson(
                clientDataJSON = Base64Url.encode(clientData),
                attestationObject = Base64Url.encode(attestationObject),
                transports = listOf("internal"),
            ),
            authenticatorAttachment = "platform",
        )
    }

    fun get(
        challenge: String,
        credentialId: String? = null,
        originOverride: String? = null,
        userHandle: String? = null,
        userVerified: Boolean = true,
    ): AuthenticationResponseJson {
        val id = credentialId ?: lastCredentialId
        val credential = credentials[id] ?: error("VirtualAuthenticator has no such credential")
        credential.counter += 1

        val authData = buildByteArray {
            append(sha256(rpId.toByteArray()))
            // UP, plus UV when the user was proven.
            append(if (userVerified) 0x05 else 0x01)
            append(credential.counter shr 24)
            append((credential.counter shr 16) and 0xff)
            append((credential.counter shr 8) and 0xff)
            append(credential.counter and 0xff)
        }

        val clientData = clientDataJson("webauthn.get", challenge, originOverride ?: origin)
        val signature = sign(credential.privateKey, authData + sha256(clientData))

        return AuthenticationResponseJson(
            id = id,
            response = AssertionResponseJson(
                clientDataJSON = Base64Url.encode(clientData),
                authenticatorData = Base64Url.encode(authData),
                signature = Base64Url.encode(signature),
                userHandle = userHandle,
            ),
            authenticatorAttachment = "platform",
        )
    }

    // ---- internals --------------------------------------------------------

    private fun coseKey(publicKey: ECPublicKey): ByteArray = cborMap(
        linkedMapOf<Any, Any>(
            1 to 2, // kty: EC2
            3 to -7, // alg: ES256
            -1 to 1, // crv: P-256
            -2 to unsignedCoordinate(publicKey.w.affineX),
            -3 to unsignedCoordinate(publicKey.w.affineY),
        ),
    )

    private fun unsignedCoordinate(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        val trimmed = if (bytes.size > 32) bytes.copyOfRange(bytes.size - 32, bytes.size) else bytes
        if (trimmed.size == 32) return trimmed
        val out = ByteArray(32)
        trimmed.copyInto(out, 32 - trimmed.size)
        return out
    }

    private fun clientDataJson(type: String, challenge: String, origin: String): ByteArray =
        """{"type":"$type","challenge":"$challenge","origin":"$origin","crossOrigin":false}"""
            .toByteArray(Charsets.UTF_8)

    private fun sign(privateKey: PrivateKey, data: ByteArray): ByteArray =
        Signature.getInstance("SHA256withECDSA").apply {
            initSign(privateKey)
            update(data)
        }.sign()

    private fun sha256(data: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(data)

    private fun randomBytes(length: Int): ByteArray = ByteArray(length).also(random::nextBytes)

    private fun buildByteArray(block: ByteArrayOutputStream.() -> Unit): ByteArray =
        ByteArrayOutputStream().also(block).toByteArray()

    private fun ByteArrayOutputStream.append(byte: Int) {
        write(byte)
    }

    private fun ByteArrayOutputStream.append(bytes: ByteArray) {
        write(bytes)
    }

    // ---- minimal CBOR -----------------------------------------------------
    // Unsigned/negative integers, byte strings, text strings and maps. Enough
    // for attestation objects and COSE keys, exactly as the TypeScript helper.

    private fun cborMap(values: Map<Any, Any>): ByteArray {
        val out = ByteArrayOutputStream()
        writeHead(out, 5, values.size)
        for ((key, value) in values) {
            writeCbor(out, key)
            writeCbor(out, value)
        }
        return out.toByteArray()
    }

    private fun writeCbor(out: ByteArrayOutputStream, value: Any) {
        when (value) {
            is Int -> writeHead(out, if (value >= 0) 0 else 1, if (value >= 0) value else -1 - value)
            is Boolean -> out.write(if (value) 0xf5 else 0xf4)
            is String -> {
                val bytes = value.toByteArray(Charsets.UTF_8)
                writeHead(out, 3, bytes.size)
                out.write(bytes)
            }
            is ByteArray -> {
                writeHead(out, 2, value.size)
                out.write(value)
            }
            is Map<*, *> -> {
                writeHead(out, 5, value.size)
                for ((key, entry) in value) {
                    writeCbor(out, key ?: error("null CBOR key"))
                    writeCbor(out, entry ?: error("null CBOR value"))
                }
            }
            else -> error("Unsupported CBOR value: $value")
        }
    }

    private fun writeHead(out: ByteArrayOutputStream, major: Int, length: Int) {
        when {
            length < 24 -> out.write((major shl 5) or length)
            length < 256 -> {
                out.write((major shl 5) or 24)
                out.write(length)
            }
            length < 65536 -> {
                out.write((major shl 5) or 25)
                out.write(length shr 8)
                out.write(length and 0xff)
            }
            else -> {
                out.write((major shl 5) or 26)
                out.write((length shr 24) and 0xff)
                out.write((length shr 16) and 0xff)
                out.write((length shr 8) and 0xff)
                out.write(length and 0xff)
            }
        }
    }
}
