// Sign update manifests exactly as `backend/src/modules/updates/sources.ts` does (Ed25519 over a
// canonical JSON array), so the harness can exercise T7.2 without importing product code.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Manifest {
  version: string;
  notes?: string;
  publishedAt?: string;
  artifactSha256?: string;
  signature?: string;
}

export function manifestPayload(m: Manifest): string {
  return JSON.stringify(["alice-update-v1", m.version, m.notes ?? "", m.publishedAt ?? "", m.artifactSha256 ?? ""]);
}

function keyEnv(runDir: string): string {
  const text = readFileSync(join(runDir, "keys.env"), "utf8");
  const line = text.split("\n").find((l) => l.startsWith("UPDATE_SIGNING_PRIVATE_KEY="));
  if (!line) throw new Error("UPDATE_SIGNING_PRIVATE_KEY is missing from keys.env");
  const raw = line.slice("UPDATE_SIGNING_PRIVATE_KEY=".length).trim();
  if (raw.includes("BEGIN")) return raw;
  return Buffer.from(raw, "base64").toString("utf8");
}

export function signWithRunKey(runDir: string, m: Manifest): Manifest {
  const pem = keyEnv(runDir);
  return { ...m, signature: sign(null, Buffer.from(manifestPayload(m)), createPrivateKey(pem)).toString("base64") };
}
