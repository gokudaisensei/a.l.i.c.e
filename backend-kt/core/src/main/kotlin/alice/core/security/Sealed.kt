package alice.core.security

import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object Sealed {
    private const val VERSION = "s1"
    private const val TAG_LEN = 16

    fun generateKeyPair(): Pair<String, String> {
        val kp = KeyPairGenerator.getInstance("RSA").apply { initialize(3072) }.generateKeyPair()
        return Base64.getEncoder().encodeToString(kp.public.encoded) to
            Base64.getEncoder().encodeToString(kp.private.encoded)
    }

    fun pemToEnv(pem: String): String = Base64.getEncoder().encodeToString(pem.toByteArray())
    fun pemFromEnv(b64: String): String = String(Base64.getDecoder().decode(b64))

    fun seal(plain: String, publicKeyB64: String): String {
        val key = randomBytes(32)
        val iv = randomBytes(12)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val combined = c.doFinal(plain.toByteArray()) // ciphertext || tag
        val cipher = combined.copyOfRange(0, combined.size - TAG_LEN)
        val tag = combined.copyOfRange(combined.size - TAG_LEN, combined.size)
        val kf = KeyFactory.getInstance("RSA")
        val pubKey = kf.generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(publicKeyB64)))
        val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        rsa.init(Cipher.ENCRYPT_MODE, pubKey)
        val wrapped = rsa.doFinal(key)
        val b64 = Base64.getUrlEncoder().withoutPadding()
        return listOf(VERSION, b64.encodeToString(wrapped), b64.encodeToString(iv), b64.encodeToString(tag), b64.encodeToString(cipher)).joinToString(".")
    }

    fun open(sealed: String, privateKeyB64: String): String {
        val parts = sealed.split(".")
        val b64 = Base64.getUrlDecoder()
        val (wrapped, iv, tag, cipher) = when {
            parts.size == 5 && parts[0] == VERSION -> {
                listOf(b64.decode(parts[1]), b64.decode(parts[2]), b64.decode(parts[3]), b64.decode(parts[4]))
            }
            // s2.<kid>.<wrapped>.<iv>.<tag>.<cipher> (key-rotation groundwork; single configured key for now)
            parts.size == 6 && parts[0] == "s2" -> {
                listOf(b64.decode(parts[2]), b64.decode(parts[3]), b64.decode(parts[4]), b64.decode(parts[5]))
            }
            else -> throw IllegalArgumentException("Unrecognised sealed format")
        }
        val kf = KeyFactory.getInstance("RSA")
        val privKey = kf.generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(privateKeyB64)))
        val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        rsa.init(Cipher.DECRYPT_MODE, privKey)
        val key = rsa.doFinal(wrapped)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        val combined = cipher + tag
        return String(c.doFinal(combined))
    }

    private fun randomBytes(n: Int): ByteArray = ByteArray(n).also { java.security.SecureRandom().nextBytes(it) }
}
