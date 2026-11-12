package alice.core.security

import alice.core.config.AppConfig
import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom
import java.util.Base64

/** Encrypts secrets before they reach the database. Values written by older builds (plaintext) still read back. */
class TokenVault(private val key: ByteArray) {
    fun seal(plain: String): String = Secrets.encryptSecret(plain, key)

    /**
     * A keyed hash for short codes (recovery and invitation codes carry only about 50 bits). Unkeyed SHA-256 of those
     * can be brute-forced offline from a leaked database or backup; without this key it cannot.
     */
    fun keyedHash(purpose: String, value: String): String {
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal("$purpose:$value".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    fun isSealed(stored: String): Boolean = stored.startsWith("v1.") && stored.count { it == '.' } == 3

    fun open(stored: String): String = if (isSealed(stored)) Secrets.decryptSecret(stored, key) else stored

    companion object {
        fun ephemeral() = TokenVault(ByteArray(32).also { SecureRandom().nextBytes(it) })

        /**
         * The configured key, else a key file beside the database (created on first use, owner-only),
         * else a throwaway key for an in-memory database.
         * shortcut: the key file sits next to the data it protects, so a copied data folder carries both; set SECRETS_KEY to separate them.
         */
        fun resolve(config: AppConfig): TokenVault {
            config.secretsKey?.let { return TokenVault(Secrets.parseKey(it)) }
            val dbPath = config.database.path
            if (dbPath.isBlank() || dbPath == ":memory:") return ephemeral()
            val file = File(File(dbPath).absoluteFile.parentFile, "secrets.key")
            if (!file.exists()) {
                file.parentFile.mkdirs()
                val fresh = Base64.getEncoder().encode(ByteArray(32).also { SecureRandom().nextBytes(it) })
                // The server and the config worker share this folder and may start together. Write the whole key to a
                // private temporary file, then publish it with a hard link, which fails if another process got there
                // first; so the file is never visible half-written and only one key ever wins.
                val tmp = Files.createTempFile(file.parentFile.toPath(), "secrets-", ".tmp")
                try {
                    runCatching { Files.setPosixFilePermissions(tmp, PosixFilePermissions.fromString("rw-------")) }
                    Files.write(tmp, fresh)
                    try { Files.createLink(file.toPath(), tmp) } catch (_: java.nio.file.FileAlreadyExistsException) { /* the other process won */ }
                } finally { Files.deleteIfExists(tmp) }
            }
            return TokenVault(Secrets.parseKey(file.readText().trim()))
        }
    }
}
