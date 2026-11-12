// Small process helper used by the env scripts. Returns output instead of throwing so callers can
// print a readable PASS/FAIL line and honour R9 (a missing prerequisite is BLOCKED, not a crash).
import { spawnSync } from "node:child_process";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

export function run(cmd: string, args: string[] = [], opts: RunOptions = {}): RunResult {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    timeout: opts.timeoutMs ?? 120_000,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    return { code: null, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: String(res.error) };
  }
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

export function runOk(cmd: string, args: string[] = [], opts: RunOptions = {}): RunResult {
  const r = run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (code ${r.code ?? "spawn error"})` +
        (r.error ? `: ${r.error}` : "") +
        (r.stderr.trim() ? `\n${r.stderr.trim()}` : "") +
        (r.stdout.trim() ? `\n${r.stdout.trim()}` : ""),
    );
  }
  return r;
}

export async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
  label = "condition",
): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return;
      lastErr = undefined;
    } catch (e) {
      lastErr = e;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${label}` + (lastErr ? `: ${String(lastErr)}` : ""),
  );
}
