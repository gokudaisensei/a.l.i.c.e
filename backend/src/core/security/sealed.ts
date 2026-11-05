import { createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, constants, randomBytes } from "node:crypto";

/**
 * A sealed box for secrets that one process may store but only another may read.
 * The main process holds the public key, so it can seal the Home Assistant admin token without ever being able to open it.
 * Only the config-worker holds the private key. Hybrid: a random AES-256-GCM key encrypts the token, RSA-OAEP encrypts that key.
 */
const VERSION = "s1";

export function generateSealKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  return { publicKey, privateKey };
}

/** Keys travel in environment variables as base64 of the PEM, which keeps them on one line. */
export const pemToEnv = (pem: string) => Buffer.from(pem, "utf8").toString("base64");
export const pemFromEnv = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

export function seal(plain: string, publicKeyPem: string): string {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const wrapped = publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
  return [VERSION, wrapped.toString("base64url"), iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function open(sealed: string, privateKeyPem: string): string {
  const [v, wrapped, iv, tag, data] = sealed.split(".");
  if (v !== VERSION || !wrapped || !iv || !tag || !data) throw new Error("Unrecognised sealed format");
  const key = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(wrapped, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
