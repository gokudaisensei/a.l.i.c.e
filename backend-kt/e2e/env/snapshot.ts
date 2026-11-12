// Save/restore an HA volume as a tar, per runbook §7 T0.6. Stops and starts only parity containers.
// Uses the already-present pinned HA image as the tar provider (see FINDINGS F-003: alpine absent).
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/proc.ts";
import { guardSingleContainer, guardContainerNames } from "./guard.ts";
import { CONTAINERS, HA_IMAGE, VOLUMES } from "./constants.ts";
import { makeRunDir } from "../lib/ids.ts";

interface Args {
  command?: "save" | "restore";
  name?: string;
  runDir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const command = argv[0] === "save" || argv[0] === "restore" ? (argv[0] as "save" | "restore") : undefined;
  let name: string | undefined;
  let runDir: string | undefined;
  let help = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--run-dir") runDir = argv[++i];
    else if (!name && !a.startsWith("-")) name = a;
  }
  return { command, name, runDir, help };
}

function dockerRunTar(args: string[], runDir: string) {
  return run("docker", args, { timeoutMs: 300_000 });
}

function withContainerStopped(container: string, fn: () => void): void {
  guardSingleContainer("stop", container);
  const stop = run("docker", ["stop", container], { timeoutMs: 60_000 });
  if (stop.code !== 0) throw new Error(`docker stop ${container} failed: ${stop.stderr.trim()}`);
  try {
    fn();
  } finally {
    guardSingleContainer("start", container);
    const start = run("docker", ["start", container], { timeoutMs: 60_000 });
    if (start.code !== 0) throw new Error(`docker start ${container} failed: ${start.stderr.trim()}`);
  }
}

/** tar the volume contents into <run>/snap/<name>-<a|b>.tgz */
export function saveSnapshot(runDir: string, name: string): void {
  const snapDir = join(runDir, "snap");
  mkdirSync(snapDir, { recursive: true });
  for (const [suffix, container, volume] of [
    ["a", CONTAINERS.haA, VOLUMES.haA],
    ["b", CONTAINERS.haB, VOLUMES.haB],
  ] as const) {
    withContainerStopped(container, () => {
      const res = dockerRunTar(
        ["run", "--rm", "-v", `${volume}:/c`, "-v", `${snapDir}:/o`, "--entrypoint", "tar", HA_IMAGE, "czf", `/o/${name}-${suffix}.tgz`, "-C", "/c", "."],
        runDir,
      );
      if (res.code !== 0) throw new Error(`snapshot ${name}-${suffix} failed: ${res.stderr.trim()}`);
      console.log(`saved ${join(snapDir, `${name}-${suffix}.tgz`)}`);
    });
  }
}

/** Restore <run>/snap/<name>-<a|b>.tgz into each volume after wiping its current contents. */
export function restoreSnapshot(runDir: string, name: string): void {
  const snapDir = join(runDir, "snap");
  for (const [suffix, container, volume] of [
    ["a", CONTAINERS.haA, VOLUMES.haA],
    ["b", CONTAINERS.haB, VOLUMES.haB],
  ] as const) {
    const tgz = join(snapDir, `${name}-${suffix}.tgz`);
    if (!existsSync(tgz)) throw new Error(`snapshot missing: ${tgz}`);
    withContainerStopped(container, () => {
      // `find -delete` instead of `rm -rf` (R4); scoped to the parity-owned volume.
      const wipe = run(
        "docker",
        ["run", "--rm", "-v", `${volume}:/c`, "--entrypoint", "sh", HA_IMAGE, "-c", "find /c -mindepth 1 -delete"],
        { timeoutMs: 120_000 },
      );
      if (wipe.code !== 0) throw new Error(`wipe ${volume} failed: ${wipe.stderr.trim()}`);
      const restore = run(
        "docker",
        ["run", "--rm", "-v", `${volume}:/c`, "-v", `${snapDir}:/o:ro`, "--entrypoint", "tar", HA_IMAGE, "xzf", `/o/${name}-${suffix}.tgz`, "-C", "/c"],
        { timeoutMs: 300_000 },
      );
      if (restore.code !== 0) throw new Error(`restore ${name}-${suffix} failed: ${restore.stderr.trim()}`);
      console.log(`restored ${tgz}`);
    });
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    console.log("usage: bun env/snapshot.ts <save|restore> <name> [--run-dir <path>]");
    return;
  }
  if (!args.name) throw new Error("snapshot name is required");
  const runDir = args.runDir ?? makeRunDir().dir;
  guardContainerNames(`${args.command} snapshot ${args.name}`, [CONTAINERS.haA, CONTAINERS.haB]);
  if (args.command === "save") saveSnapshot(runDir, args.name);
  else restoreSnapshot(runDir, args.name);
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    console.error(`SNAPSHOT FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
