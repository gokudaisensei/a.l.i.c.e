// Transcript recorder: writes the per-card evidence folder described in runbook §6.4.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Recorder {
  private reqFile: string;
  private wsFile: string;
  private haFile: string;

  constructor(public readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.reqFile = join(dir, "requests.jsonl");
    this.wsFile = join(dir, "ws.jsonl");
    this.haFile = join(dir, "ha-calls.jsonl");
    for (const f of [this.reqFile, this.wsFile, this.haFile]) writeFileSync(f, "");
  }

  request(stack: string, entry: Record<string, unknown>): void {
    appendFileSync(this.reqFile, JSON.stringify({ at: new Date().toISOString(), stack, ...entry }) + "\n");
  }

  ws(stack: string, entry: Record<string, unknown>): void {
    appendFileSync(this.wsFile, JSON.stringify({ at: new Date().toISOString(), stack, ...entry }) + "\n");
  }

  ha(entry: Record<string, unknown>): void {
    appendFileSync(this.haFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  }

  writeJson(name: string, data: unknown): string {
    const path = join(this.dir, name);
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    return path;
  }

  writeText(name: string, text: string): string {
    const path = join(this.dir, name);
    writeFileSync(path, text);
    return path;
  }
}

/** A recorder that discards everything (used by preflight/self-checks that need no evidence). */
export const nullRecorder = {
  dir: "",
  request() {},
  ws() {},
  ha() {},
  writeJson() {
    return "";
  },
  writeText() {
    return "";
  },
} satisfies Recorder;
