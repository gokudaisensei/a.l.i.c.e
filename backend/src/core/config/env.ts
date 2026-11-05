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
} as const;
