import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { AppError } from "../../core/errors/errors";

/** Somewhere Alice's own backups can be kept. Home Assistant's backups stay where Home Assistant puts them. */
export interface BackupDestination {
  readonly kind: "local" | "nas" | "upload";
  /** Can we write here right now? */
  check(): Promise<{ ok: true } | { ok: false; reason: string }>;
  put(name: string, data: Uint8Array): Promise<string>;
  get(ref: string): Promise<Uint8Array>;
  remove(ref: string): Promise<void>;
}

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

/** A folder: the default backup folder, or a mounted network share. */
export class DirectoryDestination implements BackupDestination {
  constructor(readonly kind: "local" | "nas", private readonly dir: string) {}

  /** Refs are plain file names, never paths, so a stored value cannot point outside the folder. */
  private file(ref: string) {
    if (!SAFE_NAME.test(ref) || basename(ref) !== ref) throw new AppError(400, "validation_error", "That is not a backup file name");
    const p = resolve(this.dir, ref);
    if (!p.startsWith(resolve(this.dir) + sep)) throw new AppError(400, "validation_error", "That is not a backup file name");
    return p;
  }

  async check() {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      if (!statSync(this.dir).isDirectory()) return { ok: false as const, reason: `${this.dir} is not a folder` };
      accessSync(this.dir, constants.W_OK);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, reason: `Cannot write to ${this.dir}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  async put(name: string, data: Uint8Array) {
    const c = await this.check();
    if (!c.ok) throw new AppError(502, "destination_unavailable", c.reason);
    await writeFile(this.file(name), data, { mode: 0o600 });
    return name;
  }

  async get(ref: string) {
    try { return new Uint8Array(await readFile(this.file(ref))); } catch (e) { if (e instanceof AppError) throw e; throw new AppError(404, "backup_missing", "The backup file is not there any more"); }
  }

  async remove(ref: string) {
    await rm(this.file(ref), { force: true });
  }
}

/** A remote object store. Reserved: the settings and records accept it, but nothing is sent anywhere yet. */
export class UploadDestination implements BackupDestination {
  readonly kind = "upload" as const;
  async check() { return { ok: false as const, reason: "Uploading backups to a remote store is not available yet" }; }
  async put(): Promise<string> { throw new AppError(501, "not_implemented", "Uploading backups to a remote store is not available yet"); }
  async get(): Promise<Uint8Array> { throw new AppError(501, "not_implemented", "Uploading backups to a remote store is not available yet"); }
  async remove(): Promise<void> { /* nothing was ever stored */ }
}

/** A NAS folder given by an admin must be an absolute path and not the root of the machine. */
export function validateNasPath(p: string): string {
  const path = p.trim();
  if (!isAbsolute(path) || path === "/" || path.includes("\0") || /(^|\/)\.\.(\/|$)/.test(path)) throw new AppError(400, "validation_error", "Give the full path of a folder, such as /mnt/nas/alice");
  if (["/etc", "/bin", "/usr", "/boot", "/proc", "/sys", "/dev", "/var/lib"].some((d) => path === d || path.startsWith(d + "/"))) throw new AppError(400, "validation_error", "That folder is not a good place for backups");
  return join(path);
}
