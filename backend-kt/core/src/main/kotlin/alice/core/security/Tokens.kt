package alice.core.security

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Tokens and human-typeable codes, byte-for-byte compatible with
 * `backend/src/core/security/tokens.ts`.
 */
object Tokens {
    private val random = SecureRandom()

    /** Hex SHA-256; session tokens, recovery codes and invitation codes are stored only as this. */
    fun sha256(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** URL-safe random token (session tokens), no padding. */
    fun randomToken(bytes: Int = 32): String {
        val buffer = ByteArray(bytes)
        random.nextBytes(buffer)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buffer)
    }

    private const val B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I

    fun b32(length: Int): String = buildString(length) {
        repeat(length) { append(B32[random.nextInt(B32.length)]) }
    }

    private val WORDS_A = listOf(
        "MAPLE", "CEDAR", "RIVER", "AMBER", "CORAL", "SOLAR", "LUNAR", "MINT", "OLIVE", "PEARL", "SANDY",
        "TIDAL", "WILLOW", "FROST", "EMBER", "BIRCH", "JADE", "OAK", "PINE", "ROSE", "SAGE", "SILK", "STONE",
        "SUNNY", "BREEZE", "CLOUD", "DAWN", "FERN", "GROVE", "HAZEL", "IVORY", "LILAC",
    )
    private val WORDS_B = listOf(
        "KITE", "LAMP", "HARBOR", "BELL", "BRIDGE", "COMET", "DRUM", "FALCON", "GARDEN", "HAWK", "ISLAND",
        "JUNGLE", "KETTLE", "LANTERN", "MEADOW", "NEST", "ORBIT", "PEBBLE", "QUILL", "ROBIN", "SAILOR",
        "TULIP", "UMBRELLA", "VALLEY", "WAGON", "YARN", "ZEPHYR", "ANCHOR", "BARN", "CABIN", "DAISY", "FIELD",
    )

    /** Human-friendly invitation code, about 50 bits: `MAPLE-482913-KITE-7Q4X`. */
    fun invitationCode(): String =
        "${WORDS_A[random.nextInt(WORDS_A.size)]}-" +
            random.nextInt(1_000_000).toString().padStart(6, '0') + "-" +
            "${WORDS_B[random.nextInt(WORDS_B.size)]}-${b32(4)}"

    /** One-time account recovery code, 50 bits: `ABCDE-23456`. */
    fun recoveryCode(): String = "${b32(5)}-${b32(5)}"

    /** Codes are typed by people: ignore case, spaces and stray separators. */
    fun normalizeCode(code: String): String = code.trim().uppercase().replace(Regex("\\s+"), "")

    /**
     * Compare secrets without leaking their length or a common prefix. Hashing
     * first makes both sides the same length, like the TypeScript backend.
     */
    fun constantTimeEquals(a: String, b: String): Boolean =
        MessageDigest.isEqual(sha256(a).toByteArray(Charsets.UTF_8), sha256(b).toByteArray(Charsets.UTF_8))
}
