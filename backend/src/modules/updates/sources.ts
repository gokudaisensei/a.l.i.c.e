import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AvailableUpdate {
  version: string; notes: string; publishedAt: number | null;
  /** SHA-256 of the release artifact, for whatever installs it to check. */
  artifactSha256: string | null;
  /** The manifest carried a valid signature from the configured publisher key. */
  signed: boolean;
}

/** Where Alice learns that a newer version exists. */
export interface UpdateSource {
  latest(): Promise<AvailableUpdate | null>;
}

/** Where a new version gets put in place. Alice never replaces its own code; it hands the request to whatever runs it. */
export interface UpdateInstaller {
  /** Asks for the version to be installed. The update is finished when the server next starts as that version. */
  request(version: string, kind?: "install" | "rollback", artifactSha256?: string | null): Promise<void>;
}

/** No source configured: Alice never sees an update. */
export class NoUpdateSource implements UpdateSource { async latest() { return null; } }

export interface Manifest { version: string; notes?: string; publishedAt?: string; artifactSha256?: string; signature?: string }

/** The exact bytes that are signed. Every field is included so none can be swapped without breaking the signature. */
export const manifestPayload = (m: Manifest) => JSON.stringify(["alice-update-v1", m.version, m.notes ?? "", m.publishedAt ?? "", m.artifactSha256 ?? ""]);

/** Publisher side: adds an Ed25519 signature (private key as PEM). */
export function signManifest(m: Manifest, privateKeyPem: string): Manifest {
  return { ...m, signature: sign(null, Buffer.from(manifestPayload(m)), createPrivateKey(privateKeyPem)).toString("base64") };
}

/**
 * A JSON file or endpoint: `{ version, notes, publishedAt, artifactSha256, signature }`. When a publisher public key
 * (Ed25519, PEM) is configured, a manifest without a valid signature is rejected; without a key it is accepted but not
 * marked `signed`, and installing it needs an explicit opt-in.
 */
export class ManifestUpdateSource implements UpdateSource {
  constructor(private readonly url: string, private readonly publicKeyPem: string | null = null, private readonly fetcher: typeof fetch = fetch) {}
  async latest(): Promise<AvailableUpdate | null> {
    const res = await this.fetcher(this.url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`The update manifest answered ${res.status}`);
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(j.version)) throw new Error("The update manifest has no valid version");
    const m: Manifest = {
      version: j.version, notes: typeof j.notes === "string" ? j.notes.slice(0, 2000) : undefined, publishedAt: typeof j.publishedAt === "string" ? j.publishedAt : undefined,
      artifactSha256: typeof j.artifactSha256 === "string" && /^[a-f0-9]{64}$/.test(j.artifactSha256) ? j.artifactSha256 : undefined, signature: typeof j.signature === "string" ? j.signature : undefined,
    };
    if (typeof j.notes === "string" && j.notes.length > 2000) throw new Error("The update notes are too long");
    let signed = false;
    if (this.publicKeyPem) {
      try { signed = !!m.signature && verify(null, Buffer.from(manifestPayload(m)), createPublicKey(this.publicKeyPem), Buffer.from(m.signature, "base64")); } catch { signed = false; }
      if (!signed) throw new Error("The update manifest is not signed by the publisher key, so it was ignored");
    }
    const at = m.publishedAt ? Date.parse(m.publishedAt) : NaN;
    return { version: m.version, notes: m.notes ?? "", publishedAt: Number.isFinite(at) ? at : null, artifactSha256: m.artifactSha256 ?? null, signed };
  }
}

/** Writes `update-requested.json` next to the database for a supervisor (systemd unit, deploy script) to act on. It names the version, whether this is an install or a rollback, and the artifact checksum to verify. */
export class MarkerFileInstaller implements UpdateInstaller {
  constructor(private readonly path: string, private readonly now: () => number = Date.now) {}
  async request(version: string, kind: "install" | "rollback" = "install", artifactSha256: string | null = null) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify({ kind, version, artifactSha256, requestedAt: this.now() }), { mode: 0o600 });
  }
}

/** `a` is newer than `b`. Pre-release versions sort before the release. */
export function isNewer(a: string, b: string): boolean {
  const p = (v: string) => { const [core, pre] = v.split("-", 2); return { n: core!.split(".").map(Number), pre: pre ?? null }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] ?? 0) !== (y.n[i] ?? 0)) return (x.n[i] ?? 0) > (y.n[i] ?? 0);
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
}
