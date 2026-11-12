package alice.core.config

import com.sksamuel.hoplite.ConfigLoader

/**
 * Everything the process needs to boot. Defaults are deliberately usable so
 * `./gradlew :server:run` works with no configuration at all.
 *
 * Precedence: environment variables > `application.yaml`/`application.yml` in
 * the working directory > the defaults below. Environment names are applied
 * explicitly in [ConfigLoaderFactory] (not through Hoplite's reflection-based
 * environment source) so the names match the TypeScript backend exactly and
 * the mapping is testable without mutating the process environment.
 */
data class AppConfig(
    val app: AppInfo = AppInfo(),
    val server: ServerConfig = ServerConfig(),
    val database: DatabaseConfig = DatabaseConfig(),
    val webauthn: WebAuthnConfig = WebAuthnConfig(),
    val auth: AuthConfig = AuthConfig(),
    val http: HttpConfig = HttpConfig(),
    val smart: SmartConfig = SmartConfig(),
    val push: PushConfig = PushConfig(),
    /** Base64 PEM public key used to seal HA admin tokens for the config-worker. */
    val adminSealPublicKey: String? = null,
    /** Base64 32-byte key that encrypts stored secrets (the HA token). Unset: a key file is kept next to the database. */
    val secretsKey: String? = null,
    val updates: UpdateConfig = UpdateConfig(),
    val ai: AiConfig = AiConfig(),
) {
    /**
     * Origins allowed to make cookie-authenticated state changes and open
     * sockets. The WebAuthn origin is always included: a browser sends it as
     * `Origin` on same-origin POSTs too.
     */
    val allowedOrigins: Set<String>
        get() = (http.corsOrigins + webauthn.origin).toSet()

    val secureCookies: Boolean
        get() = webauthn.origin.startsWith("https:")
}

data class AppInfo(
    val name: String = "alice",
    val version: String = "0.1.0",
    /** `NODE_ENV` in the TypeScript backend; drives setup-code generation. */
    val environment: String = "development",
)

data class ServerConfig(
    val host: String = "0.0.0.0",
    val port: Int = 3002,
)

data class DatabaseConfig(
    val path: String = "data/alice.db",
)

data class WebAuthnConfig(
    val rpId: String = "localhost",
    val rpName: String = "Alice",
    val origin: String = "http://localhost:3000",
    /**
     * More origins a passkey ceremony may report, for native apps. Android reports
     * `android:apk-key-hash:<base64url sha256 of the app signing certificate>`.
     */
    val extraOrigins: List<String> = emptyList(),
)

data class AuthConfig(
    /** 30 days by default; a session in use slides up to 90 days in total. */
    val sessionTtlHours: Int = 720,
    /** When set, the first registration on a new install must present it. */
    val setupCode: String? = null,
    /** How long a fresh passkey assertion counts as a step-up. */
    val stepUpTtlMinutes: Int = 5,
    val challengeTtlMinutes: Int = 5,
    /** Require user verification at login (not just step-up). Default false matches TS. */
    val requireUvAtLogin: Boolean = false,
    /** Accept attestation statements that have no trusted root (normal for passkeys). */
    val allowUntrustedAttestation: Boolean = true,
    /** When non-empty, a credential's AAGUID must be in this list. */
    val aaguidAllowlist: List<String> = emptyList(),
)

data class HttpConfig(
    /** Trust `X-Forwarded-For` for client IPs; only behind a proxy you control. */
    val trustProxy: Boolean = false,
    val corsOrigins: List<String> = listOf("http://localhost:3000"),
)

data class SmartConfig(
    val ordering: Boolean = true,
    val hints: Boolean = true,
    val search: Boolean = true,
    val scenes: Boolean = true,
)



data class PushConfig(
    val vapidPublicKey: String? = null,
    val vapidPrivateKey: String? = null,
    val vapidSubject: String = "mailto:admin@localhost",
    /** Base64-encoded Firebase service account JSON. */
    val fcmServiceAccount: String? = null,
    /** Comma/space not used; list of regex patterns for allowed web push endpoint hosts. */
    val webPushHostAllowlist: List<String> = emptyList(),
)


data class UpdateConfig(
    val manifestUrl: String? = null,
    val signingPublicKey: String? = null,
    val allowUnsigned: Boolean = false,
)

data class AiConfig(
    val apiKey: String? = null,
    val model: String = "claude-haiku-5-5",
    /** When false, the language-model fallback is disabled even if configured. */
    val enabled: Boolean = true,
)

object ConfigLoaderFactory {


    fun load(env: Map<String, String> = System.getenv()): AppConfig {
        val base = ConfigLoader.builder()
            .addDefaultPropertySources()
            .build()
            .loadConfigOrThrow<AppConfig>()

        return base.copy(
            app = base.app.copy(
                name = env["APP_NAME"] ?: base.app.name,
                version = env["APP_VERSION"] ?: base.app.version,
                environment = env["NODE_ENV"] ?: base.app.environment,
            ),
            server = base.server.copy(
                host = env["SERVER_HOST"] ?: base.server.host,
                // `PORT` is the TypeScript backend's name; SERVER_PORT is this
                // backend's own and wins when both are set.
                port = env.int("SERVER_PORT") ?: env.int("PORT") ?: base.server.port,
            ),
            database = base.database.copy(
                // `DATABASE_URL` is the TypeScript backend's name.
                path = env["DATABASE_PATH"] ?: env["DATABASE_URL"] ?: base.database.path,
            ),
            webauthn = base.webauthn.copy(
                rpId = env["WEBAUTHN_RP_ID"] ?: base.webauthn.rpId,
                rpName = env["WEBAUTHN_RP_NAME"] ?: base.webauthn.rpName,
                origin = env["WEBAUTHN_ORIGIN"] ?: base.webauthn.origin,
                extraOrigins = env["WEBAUTHN_EXTRA_ORIGINS"]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
                    ?: base.webauthn.extraOrigins,
            ),
            auth = base.auth.copy(
                sessionTtlHours = env.int("SESSION_TTL_HOURS") ?: base.auth.sessionTtlHours,
                setupCode = env["SETUP_CODE"]?.takeIf { it.isNotBlank() } ?: base.auth.setupCode,
                stepUpTtlMinutes = env.int("STEP_UP_TTL_MINUTES") ?: base.auth.stepUpTtlMinutes,
                challengeTtlMinutes = env.int("CHALLENGE_TTL_MINUTES") ?: base.auth.challengeTtlMinutes,
                requireUvAtLogin = env.bool("REQUIRE_UV_AT_LOGIN") ?: base.auth.requireUvAtLogin,
                allowUntrustedAttestation = env.bool("AUTH_ATTESTATION_UNTRUSTED")
                    ?: base.auth.allowUntrustedAttestation,
                aaguidAllowlist = env["AUTH_AAGUID_ALLOWLIST"]
                    ?.split(',')
                    ?.map { it.trim().lowercase() }
                    ?.filter { it.isNotEmpty() }
                    ?: base.auth.aaguidAllowlist,
            ),
            http = base.http.copy(
                trustProxy = env.bool("TRUST_PROXY") ?: base.http.trustProxy,
                corsOrigins = env["CORS_ORIGINS"]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
                    ?: base.http.corsOrigins,
            ),
            smart = base.smart.copy(
                ordering = env.bool("SMART_ORDERING") ?: base.smart.ordering,
                hints = env.bool("SMART_HINTS") ?: base.smart.hints,
                search = env.bool("SMART_SEARCH") ?: base.smart.search,
                scenes = env.bool("SMART_SCENES") ?: base.smart.scenes,
            ),
            push = base.push.copy(
                vapidPublicKey = env["VAPID_PUBLIC_KEY"]?.takeIf { it.isNotBlank() } ?: base.push.vapidPublicKey,
                vapidPrivateKey = env["VAPID_PRIVATE_KEY"]?.takeIf { it.isNotBlank() } ?: base.push.vapidPrivateKey,
                vapidSubject = env["VAPID_SUBJECT"]?.takeIf { it.isNotBlank() } ?: base.push.vapidSubject,
                fcmServiceAccount = env["FCM_SERVICE_ACCOUNT"]?.takeIf { it.isNotBlank() } ?: base.push.fcmServiceAccount,
                webPushHostAllowlist = env["WEB_PUSH_HOST_ALLOWLIST"]?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
                    ?: base.push.webPushHostAllowlist,
            ),
            adminSealPublicKey = env["ADMIN_SEAL_PUBLIC_KEY"]?.takeIf { it.isNotBlank() } ?: base.adminSealPublicKey,
            secretsKey = env["SECRETS_KEY"]?.takeIf { it.isNotBlank() } ?: base.secretsKey,
            updates = base.updates.copy(
                manifestUrl = env["UPDATE_MANIFEST_URL"]?.takeIf { it.isNotBlank() } ?: base.updates.manifestUrl,
                signingPublicKey = env["UPDATE_SIGNING_PUBLIC_KEY"]?.takeIf { it.isNotBlank() } ?: base.updates.signingPublicKey,
                allowUnsigned = env.bool("UPDATE_ALLOW_UNSIGNED") ?: base.updates.allowUnsigned,
            ),
            ai = base.ai.copy(
                apiKey = env["AI_API_KEY"]?.takeIf { it.isNotBlank() } ?: base.ai.apiKey,
                model = env["AI_MODEL"]?.takeIf { it.isNotBlank() } ?: base.ai.model,
                enabled = env.bool("AI_ENABLED") ?: base.ai.enabled,
            ),
        )
    }

    private fun Map<String, String>.int(name: String): Int? {
        val raw = this[name] ?: return null
        return raw.toIntOrNull() ?: throw IllegalArgumentException("$name must be an integer, got '$raw'")
    }

    private fun Map<String, String>.bool(name: String): Boolean? {
        val raw = this[name] ?: return null
        return when (raw.lowercase()) {
            "1", "true", "yes" -> true
            "0", "false", "no" -> false
            else -> throw IllegalArgumentException("$name must be a boolean, got '$raw'")
        }
    }
}
