package alice.core.security

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Secrets {
    private const val VERSION = "v1"
    private const val TAG_LEN = 16

    fun parseKey(b64: String?): ByteArray {
        if (b64.isNullOrBlank()) throw IllegalArgumentException("SECRETS_KEY is not set. Generate one with: openssl rand -base64 32")
        val key = Base64.getDecoder().decode(b64)
        if (key.size != 32) throw IllegalArgumentException("SECRETS_KEY must be 32 bytes, base64 encoded")
        return key
    }

    fun encryptSecret(plain: String, key: ByteArray): String {
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val combined = c.doFinal(plain.toByteArray()) // ciphertext || tag
        val cipher = combined.copyOfRange(0, combined.size - TAG_LEN)
        val tag = combined.copyOfRange(combined.size - TAG_LEN, combined.size)
        val b64 = Base64.getUrlEncoder().withoutPadding()
        return listOf(VERSION, b64.encodeToString(iv), b64.encodeToString(tag), b64.encodeToString(cipher)).joinToString(".")
    }

    fun decryptSecret(token: String, key: ByteArray): String {
        val parts = token.split(".")
        if (parts.size != 4 || parts[0] != VERSION) throw IllegalArgumentException("Unrecognised secret format")
        val b64 = Base64.getUrlDecoder()
        val iv = b64.decode(parts[1])
        val tag = b64.decode(parts[2])
        val cipher = b64.decode(parts[3])
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val combined = cipher + tag
        return String(c.doFinal(combined))
    }
}
