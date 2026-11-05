import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** Parses a base64 32-byte key (openssl rand -base64 32). */
export function parseKey(b64: string | null | undefined): Buffer {
  if (!b64) throw new Error("SECRETS_KEY is not set. Generate one with: openssl rand -base64 32");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64 encoded");
  return key;
}

/** AES-256-GCM. Output: v1.iv.tag.ciphertext (base64url). A fresh random IV per message. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(token: string, key: Buffer): string {
  const [v, iv, tag, data] = token.split(".");
  if (v !== VERSION || !iv || !tag || !data) throw new Error("Unrecognised secret format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
