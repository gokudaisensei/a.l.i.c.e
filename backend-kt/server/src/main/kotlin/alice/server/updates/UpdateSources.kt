package alice.server.updates

import kotlinx.serialization.json.put
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Duration
import java.util.Base64
import kotlinx.serialization.Serializable

@Serializable
data class AvailableUpdate(
    val version: String,
    val notes: String = "",
    val publishedAt: Long? = null,
    val artifactSha256: String? = null,
    val signed: Boolean = false,
)

interface UpdateSource {
    suspend fun latest(): AvailableUpdate?
}

interface UpdateInstaller {
    suspend fun request(version: String, kind: String = "install", artifactSha256: String? = null)
}

class NoUpdateSource : UpdateSource {
    override suspend fun latest(): AvailableUpdate? = null
}

@Serializable
data class Manifest(
    val version: String,
    val notes: String? = null,
    val publishedAt: String? = null,
    val artifactSha256: String? = null,
    val signature: String? = null,
)

/** Exact bytes signed, matching TS manifestPayload. */
fun manifestPayload(m: Manifest): String =
    kotlinx.serialization.json.Json.encodeToString(
        kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.serializer<String>()),
        listOf("alice-update-v1", m.version, m.notes ?: "", m.publishedAt ?: "", m.artifactSha256 ?: "")
    )

fun isNewer(a: String, b: String): Boolean {
    data class P(val n: List<Int>, val pre: String?)
    fun p(v: String): P {
        val parts = v.split("-", limit = 2)
        val core = parts[0].split('.').map { it.toIntOrNull() ?: 0 }
        return P(core + List((3 - core.size).coerceAtLeast(0)) { 0 }, parts.getOrNull(1))
    }
    val x = p(a); val y = p(b)
    for (i in 0 until 3) {
        val xi = x.n.getOrElse(i) { 0 }; val yi = y.n.getOrElse(i) { 0 }
        if (xi != yi) return xi > yi
    }
    if (x.pre == y.pre) return false
    if (x.pre == null) return true
    if (y.pre == null) return false
    return x.pre > y.pre
}

private val VERSION_RE = Regex("""^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$""")
private val SHA_RE = Regex("""^[a-f0-9]{64}$""")

class ManifestUpdateSource(
    private val url: String,
    private val publicKeyPem: String? = null,
    private val client: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
) : UpdateSource {
    private fun parseKeys(pemBlob: String?): List<String> {
        val raw = pemBlob?.trim().orEmpty()
        if (raw.isEmpty()) return emptyList()
        // support rotation: multiple PEM public keys separated by blank lines or explicit separators
        val normalized = raw.replace("\\n", "\n")
        val blocks = Regex("-----BEGIN PUBLIC KEY-----[\\s\\S]*?-----END PUBLIC KEY-----").findAll(normalized).map { it.value.trim() }.toList()
        if (blocks.isNotEmpty()) return blocks
        return normalized.split('|', ';').map { it.trim() }.filter { it.isNotEmpty() }
    }

    override suspend fun latest(): AvailableUpdate? {
        val req = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(10))
            .header("accept", "application/json")
            .GET().build()
        val res = client.send(req, HttpResponse.BodyHandlers.ofString())
        if (res.statusCode() !in 200..299) throw IllegalStateException("The update manifest answered ${res.statusCode()}")
        val j = kotlinx.serialization.json.Json.parseToJsonElement(res.body()) as? kotlinx.serialization.json.JsonObject
            ?: throw IllegalStateException("The update manifest is not a JSON object")
        fun str(k: String) = (j[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
        val version = str("version") ?: throw IllegalStateException("The update manifest has no valid version")
        if (!VERSION_RE.matches(version)) throw IllegalStateException("The update manifest has no valid version")
        val notesRaw = str("notes")
        if (notesRaw != null && notesRaw.length > 2000) throw IllegalStateException("The update notes are too long")
        val m = Manifest(
            version = version,
            notes = notesRaw?.take(2000),
            publishedAt = str("publishedAt"),
            artifactSha256 = str("artifactSha256")?.takeIf { SHA_RE.matches(it) },
            signature = str("signature"),
        )
        var signed = false
        val keys = parseKeys(publicKeyPem)
        val sigBytes = m.signature?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
        if (keys.isNotEmpty()) {
            val payload = manifestPayload(m).toByteArray(Charsets.UTF_8)
            signed = sigBytes != null && keys.any { k ->
                runCatching { verifyEd25519(payload, sigBytes, k) }.getOrDefault(false)
            }
            if (!signed) throw IllegalStateException("The update manifest is not signed by the publisher key, so it was ignored")
        }
        val at = m.publishedAt?.let { raw ->
            runCatching { java.time.Instant.parse(raw).toEpochMilli() }.getOrNull()
                ?: runCatching { java.time.OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
        }
        // basic expiry/freshness sanity when timestamp is present (best-effort hardening, L84)
        if (at != null) {
            val now = System.currentTimeMillis()
            val skew = 15 * 60_000L
            val maxAge = 365L * 24 * 60 * 60 * 1000
            if (at > now + 24 * 60 * 60 * 1000L + skew) throw IllegalStateException("The update manifest time is not acceptable")
            if (keys.isNotEmpty() && at < now - maxAge) throw IllegalStateException("The update manifest is too old to trust")
        }
        return AvailableUpdate(
            version = m.version,
            notes = m.notes ?: "",
            publishedAt = at,
            artifactSha256 = m.artifactSha256,
            signed = signed,
        )
    }
}

private fun verifyEd25519(data: ByteArray, signature: ByteArray, publicKeyPem: String): Boolean {
    val pem = publicKeyPem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace("\\s".toRegex(), "")
    val keyBytes = Base64.getDecoder().decode(pem)
    val pub = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(keyBytes))
    val v = Signature.getInstance("Ed25519")
    v.initVerify(pub)
    v.update(data)
    return v.verify(signature)
}

/** Writes update-requested.json next to the database for a supervisor to act on. */
class MarkerFileInstaller(
    private val path: String,
    private val now: () -> Long = { System.currentTimeMillis() },
) : UpdateInstaller {
    override suspend fun request(version: String, kind: String, artifactSha256: String?) {
        val f = File(path)
        f.parentFile?.mkdirs()
        val body = kotlinx.serialization.json.buildJsonObject {
            put("kind", kind)
            put("version", version)
            put("artifactSha256", artifactSha256)
            put("requestedAt", now())
        }.toString()
        Files.write(f.toPath(), body.toByteArray(Charsets.UTF_8))
        runCatching {
            val perms = java.util.EnumSet.of(
                java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                java.nio.file.attribute.PosixFilePermission.OWNER_WRITE,
            )
            Files.setPosixFilePermissions(f.toPath(), perms)
        }
    }
}
