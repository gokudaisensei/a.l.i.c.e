function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env var: ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const n = Number(process.env[name] ?? fallback);
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
  /** Trust X-Forwarded-For for client IPs. Only behind a reverse proxy you control. */
  trustProxy: bool("TRUST_PROXY", false),
  /** 32-byte base64 key that encrypts stored Home Assistant tokens. Generate: openssl rand -base64 32 */
  secretsKey: process.env.SECRETS_KEY ?? null,
  /** Main server: seals the HA admin token so only the config-worker can read it. */
  adminSealPublicKey: process.env.ADMIN_SEAL_PUBLIC_KEY ?? null,
  /** Config-worker only. */
  adminSealPrivateKey: process.env.ADMIN_SEAL_PRIVATE_KEY ?? null,
  /** Web Push (VAPID). Generate with `bun run keys:generate`. */
  vapid: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT ?? "mailto:admin@localhost" } : null,
  /** Firebase Cloud Messaging service account, as base64 of the JSON key file. */
  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT ?? null,
} as const;
