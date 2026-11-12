// Normalizer per runbook §8.2. Volatile values become typed placeholders so a structural diff can
// tell "same contract, different id/timestamp" from "different contract".
import { deepEqual } from "./diff.ts";

export interface NormalizeOptions {
  /** Inclusive test window (ms). Timestamps outside ±5 s become `<ts:out-of-window>`. */
  window?: { start: number; end: number };
  /** Keys whose arrays are compared as unordered sets. */
  unordered?: string[];
}

const ULID_RE = /\b([a-z]{2,10})_[0-9A-HJKMNP-TV-Z]{26}\b/g;
const ISO_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const B64URL_RE = /^[A-Za-z0-9_-]{16,}={0,2}$/;

const SECRET_KEYS = new Set([
  "challenge",
  "setupCode",
  "recoveryCodes",
  "recoveryCode",
  "invitationCode",
  "token",
  "accessToken",
  "refreshToken",
  "sessionToken",
  "secret",
  "signature",
  "clientDataJSON",
  "attestationObject",
  "authenticatorData",
  "userHandle",
  "sealed",
]);

const WINDOW_SLACK_MS = 5_000;

function tsInWindow(ms: number, window?: NormalizeOptions["window"]): string {
  if (!window) return "<ts>";
  if (ms < window.start - WINDOW_SLACK_MS || ms > window.end + WINDOW_SLACK_MS) return "<ts:out-of-window>";
  return "<ts>";
}

function normalizeString(value: string, opts: NormalizeOptions): string {
  let out = value;
  out = out.replace(ULID_RE, (_m, prefix: string) => `<id:${prefix}:${_m.length}>`);
  out = out.replace(ISO_RE, (m) => {
    const t = Date.parse(m);
    return Number.isNaN(t) ? m : tsInWindow(t, opts.window);
  });
  // Opaque credential/token segments (raw base64url WebAuthn ids in URLs). A segment made only of
  // lower-case route words (`definitely-not-a-route`) is left alone; a base64url id almost always
  // carries an upper-case letter or a digit.
  out = out.replace(/[A-Za-z0-9_-]{24,}/g, (m) => (/[A-Z0-9]/.test(m) ? `<token:${m.length}>` : m));
  return out;
}

function normalizeSecret(value: unknown): unknown {
  if (typeof value === "string") return `<secret:${value.length}>`;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? `<secret:${v.length}>` : v));
  return value;
}

export function normalize(value: unknown, opts: NormalizeOptions = {}, key?: string): unknown {
  // Key-driven rules first.
  if (typeof value === "string" && key) {
    if (SECRET_KEYS.has(key)) return `<secret:${value.length}>`;
    if ((key === "id" || key === "rawId" || key === "credentialId") && B64URL_RE.test(value) && !ULID_RE.test(value)) {
      ULID_RE.lastIndex = 0;
      return `<b64:${value.length}>`;
    }
    // Invitation codes have a stable human format; error codes never do. Word lengths vary, so the
    // code is masked without its length (unlike a token whose length is contractual).
    if (key === "code" && /^[A-Z]+-\d{6}-[A-Z]+-[A-Z0-9]{4}$/.test(value)) return "<invitation-code>";
    if (key === "version") return "<string>";
    // A wrong-typed uptime must stay wrong-typed after normalization (string here, compared to the
    // number placeholder below), otherwise "type compared" in §8.2 would be a lie.
    if (key === "uptime") return "<not-number>";
  }
  if (key === "uptime" && typeof value === "number") return 0;

  if (typeof value === "string") return normalizeString(value, opts);
  if (typeof value === "number") {
    if (value >= 1_000_000_000_000 && value <= 4_000_000_000_000) return tsInWindow(value, opts.window);
    return value;
  }
  if (Array.isArray(value)) {
    const arr = value.map((v) => normalize(v, opts, key));
    if (key && opts.unordered?.includes(key)) {
      return [...arr].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return arr;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v, opts, k);
    }
    return out;
  }
  return value;
}

export function normalizeEqual(a: unknown, b: unknown, opts: NormalizeOptions = {}): boolean {
  return deepEqual(normalize(a, opts), normalize(b, opts));
}
