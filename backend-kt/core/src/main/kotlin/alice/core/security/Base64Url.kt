package alice.core.security

import java.util.Base64

/** Unpadded base64url, the encoding WebAuthn JSON uses for every byte string. */
object Base64Url {
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val decoder = Base64.getUrlDecoder()

    fun encode(bytes: ByteArray): String = encoder.encodeToString(bytes)

    fun decode(value: String): ByteArray = decoder.decode(value.trimEnd('='))
}
