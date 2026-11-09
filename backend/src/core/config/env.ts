function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env var: ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const n = Number(process.env[name] || fallback);
  if (!Number.isInteger(n)) throw new Error(`Env var ${name} must be an integer`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  return v === undefined ? fallback : ["1", "true", "yes"].includes(v.toLowerCase());
}

export const env = {
  nodeEnv: str("NODE_ENV", "development"),
  port: int("PORT", 3001),
  logLevel: str("LOG_LEVEL", "info"),
  databaseUrl: str("DATABASE_URL", "./data/alice.db"),
  corsOrigins: str("CORS_ORIGINS", "http://localhost:3000").split(","),
  webauthn: {
    rpId: str("WEBAUTHN_RP_ID", "localhost"),
    rpName: str("WEBAUTHN_RP_NAME", "Alice"),
    origin: str("WEBAUTHN_ORIGIN", "http://localhost:3000"),
  },
  sessionTtlHours: int("SESSION_TTL_HOURS", 720),
  /** Needed to register the first person on a new install. In production, one is generated and logged at start when this is unset. */
  setupCode: process.env.SETUP_CODE || null,
  /** Trust X-Forwarded-For for client IPs. Only behind a reverse proxy you control. */
  trustProxy: bool("TRUST_PROXY", false),
  /** 32-byte base64 key that encrypts stored Home Assistant tokens. Generate: openssl rand -base64 32 */
  secretsKey: process.env.SECRETS_KEY ?? null,
  /** Main server: seals the HA admin token so only the config-worker can read it. */
  adminSealPublicKey: process.env.ADMIN_SEAL_PUBLIC_KEY ?? null,
  /** Config-worker only. */
  adminSealPrivateKey: process.env.ADMIN_SEAL_PRIVATE_KEY ?? null,
  /** 32-byte base64 key that encrypts Alice's own backups. Recommended whenever they leave this machine (NAS, upload). */
  backupEncryptionKey: process.env.BACKUP_ENCRYPTION_KEY ?? null,
  /** Where local backups go. Defaults to a `backups` folder next to the database. */
  backupDir: process.env.BACKUP_DIR ?? null,
  /** A JSON manifest saying which version is newest. Without it Alice never sees an update. */
  updateManifestUrl: process.env.UPDATE_MANIFEST_URL ?? null,
  /** Base64 PEM of the publisher's Ed25519 public key. With it, unsigned manifests are rejected. */
  updateSigningPublicKey: process.env.UPDATE_SIGNING_PUBLIC_KEY ?? null,
  /** Allow installing a manifest that is not signed (no key configured). Off by default. */
  updateAllowUnsigned: process.env.UPDATE_ALLOW_UNSIGNED === "true",
  /** Optional: lets Ask Alice ask Claude when its own rules find nothing. The model sees device and room names and the sentence typed, nothing else. */
  aiApiKey: process.env.AI_API_KEY ?? null,
  aiModel: process.env.AI_MODEL ?? "claude-haiku-5-5",
  /** Web Push (VAPID). Generate with `bun run keys:generate`. */
  vapid: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT ?? "mailto:admin@localhost" } : null,
  /** Firebase Cloud Messaging service account, as base64 of the JSON key file. */
  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT ?? null,
} as const;
