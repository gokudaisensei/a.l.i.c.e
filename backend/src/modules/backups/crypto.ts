import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("ALBK1");

export class BackupFormatError extends Error {}

export function parseBackupKey(b64: string | null | undefined): Buffer | null {
  if (!b64) return null;
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
}

/** Compresses, then (with a key) encrypts with AES-256-GCM: ALBK1 + iv + tag + ciphertext. Without a key it is a plain gzip file. */
export function packBackup(raw: Uint8Array, key: Buffer | null): { bytes: Buffer; encrypted: boolean } {
  const gz = gzipSync(raw);
  if (!key) return { bytes: gz, encrypted: false };
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gz), c.final()]);
  return { bytes: Buffer.concat([MAGIC, iv, c.getAuthTag(), body]), encrypted: true };
}

/** Reverses `packBackup`. Throws BackupFormatError if the file is not a backup, is damaged, or the key is wrong. */
export function unpackBackup(bytes: Uint8Array, key: Buffer | null): Buffer {
  const b = Buffer.from(bytes);
  try {
    if (b.subarray(0, MAGIC.length).equals(MAGIC)) {
      if (!key) throw new BackupFormatError("This backup is encrypted and no backup key is set");
      const d = createDecipheriv("aes-256-gcm", key, b.subarray(5, 17));
      d.setAuthTag(b.subarray(17, 33));
      return gunzipSync(Buffer.concat([d.update(b.subarray(33)), d.final()]));
    }
    return gunzipSync(b);
  } catch (e) {
    if (e instanceof BackupFormatError) throw e;
    throw new BackupFormatError("The backup is damaged, or the backup key is not the one it was made with");
  }
}
