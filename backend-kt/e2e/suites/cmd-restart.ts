// T4.1 restart recovery: with Home Assistant behind the 3193 latency proxy, kill -9 the server
// between dispatch and confirmation, restart it against the same database, and require the command
// to be resolved (failed/interrupted) rather than stuck.
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { HttpClient } from "../lib/http.ts";
import { Recorder } from "../lib/record.ts";
import { makeRunDir } from "../lib/ids.ts";
import type { Side } from "../lib/scenario.ts";
import { BACKEND_URL, PORTS } from "../env/constants.ts";
import { startLatencyProxy } from "../env/fake-services.ts";
import { startBackend } from "../env/stack.ts";
import { buildWorld, loadHaCreds, waitDevices, waitHaConnected } from "./scenario-support.ts";
import { devices, sendCommand, waitCommand } from "./cmd-support.ts";

interface RestartCase {
  backend: "ts" | "kt";
  commandId: string | null;
  preKillState: string | null;
  postRestartState: string | null;
  failureCode: string | null;
  ok: boolean;
  note: string;
}

function killRecorded(runDir: string, names: string[]): void {
  const records = JSON.parse(readFileSync(join(runDir, "pids.json"), "utf8")) as { name: string; pid: number }[];
  for (const rec of records) {
    if (!names.includes(rec.name)) continue;
    try {
      process.kill(rec.pid, "SIGKILL");
    } catch {}
  }
}

async function waitHealth(backend: "ts" | "kt"): Promise<void> {
  const url = backend === "ts" ? BACKEND_URL.ts : BACKEND_URL.kt;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.status === 200) return;
    } catch {}
    await Bun.sleep(250);
  }
  throw new Error(`${backend} did not come back after restart`);
}

export async function runRestartRecovery(runDir: string): Promise<RestartCase[]> {
  const ctx = makeRunDir(runDir);
  const creds = loadHaCreds(runDir);
  if (!creds) throw new Error("T4.1 needs ha-a.env; run `bun env/up.ts --run-dir <this run>` first");

  const proxy = startLatencyProxy(PORTS.fakeLatency, PORTS.haA, 500);
  const recorder = new Recorder(join(runDir, "evidence", "E2E-CMD-T41"));
  const sides: { ts: Side; kt: Side } = {
    ts: {
      backend: "ts", runDir, baseUrl: BACKEND_URL.ts, origin: "http://localhost:3101", setupCode: ctx.setupCode,
      http: new HttpClient(BACKEND_URL.ts, "ts", recorder), recorder, exchanges: [], world: { kind: "fresh", actors: {} },
    },
    kt: {
      backend: "kt", runDir, baseUrl: BACKEND_URL.kt, origin: "http://localhost:3102", setupCode: ctx.setupCode,
      http: new HttpClient(BACKEND_URL.kt, "kt", recorder), recorder, exchanges: [], world: { kind: "fresh", actors: {} },
    },
  };

  const cases: RestartCase[] = [];
  try {
    // A fresh world on both stacks; retain the databases across the kill so recovery can see them.
    const { resetBackends } = await import("../env/stack.ts");
    await resetBackends(ctx, "both");
    const worlds = {
      ts: await buildWorld(sides.ts, "household", ctx.setupCode),
      kt: await buildWorld(sides.kt, "household", ctx.setupCode),
    };
    const proxied = `http://127.0.0.1:${PORTS.fakeLatency}`;
    for (const side of ["ts", "kt"] as const) {
      const admin = worlds[side].actors.admin!;
      const put = await admin.call(`t41.connect.${side}`, "PUT", "/api/v1/ha/connection", { body: { baseUrl: proxied, token: creds.token } });
      if (put.status !== 200) throw new Error(`${side}: HA connection via proxy failed (${put.status})`);
      await waitHaConnected(admin, 90_000);
      await waitDevices(admin, 10, 120_000);
    }

    for (const backend of ["ts", "kt"] as const) {
      const side = sides[backend];
      const admin = worlds[backend].actors.admin!;
      const list = await devices(admin);
      const target = list.find((d) => d.primary?.domain === "switch") ?? list[0];
      const pre = await admin.call(`t41.before.${backend}`, "GET", `/api/v1/devices/${target.id}`);
      void pre;

      const postPromise = sendCommand(admin, `t41.command.${backend}`, target.id, "turn_off").catch((e) => e as Error);
      let preKill: string | null = null;
      if (backend === "ts") {
        const sent = await postPromise;
        if (sent instanceof Error) throw sent;
        const id = (sent as any).body?.id as string;
        for (let i = 0; i < 60; i++) {
          const probe = new HttpClient(BACKEND_URL.ts, "ts");
          const res = await probe.request<any>("GET", `/api/v1/commands/${id}`, { cookie: admin.http.jar.header() });
          preKill = res.body?.state ?? null;
          if (preKill === "dispatched" || preKill === "accepted") break;
          await Bun.sleep(100);
        }
        killRecorded(runDir, ["ts-server", "ts-worker"]);
      } else {
        await Bun.sleep(650);
        killRecorded(runDir, ["kt-server", "kt-worker"]);
      }
      await postPromise;
      await Bun.sleep(500);
      await startBackend(ctx, backend);
      await waitHealth(backend);

      // Find the command id from the recorded request if the response never arrived (Kotlin was killed mid-request).
      let commandId: string | null = null;
      for (const ex of side.exchanges) {
        if (ex.label === `t41.command.${backend}` && ex.body && typeof (ex.body as any).id === "string") commandId = (ex.body as any).id;
      }
      if (!commandId) {
        const listRes = await admin.call(`t41.list.${backend}`, "GET", "/api/v1/commands?limit=5");
        const cmds = ((listRes.body as any)?.commands ?? []) as any[];
        commandId = cmds[0]?.id ?? null;
      }
      const final = commandId ? await waitCommand(admin, commandId, 30_000) : null;
      cases.push({
        backend,
        commandId,
        preKillState: preKill,
        postRestartState: final?.state ?? null,
        failureCode: final?.failure?.code ?? null,
        ok: final?.state === "failed" && final?.failure?.code === "interrupted",
        note: final ? "command resolved after restart" : "no command id recovered",
      });
    }
  } finally {
    proxy.stop();
  }

  writeFileSync(join(runDir, "cmd-restart.json"), JSON.stringify(cases, null, 2) + "\n");
  const md = [
    "# T4.1 restart recovery",
    "",
    "| Backend | Command | Before kill | After restart | Failure code | OK |",
    "| --- | --- | --- | --- | --- | --- |",
    ...cases.map((c) => `| ${c.backend} | \`${c.commandId ?? "—"}\` | ${c.preKillState ?? "—"} | ${c.postRestartState ?? "—"} | ${c.failureCode ?? "—"} | ${c.ok ? "yes" : "no"} |`),
    "",
  ].join("\n");
  writeFileSync(join(runDir, "cmd-restart.md"), md);
  return cases;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun suites/cmd-restart.ts <run-dir>");
    process.exit(1);
  }
  runRestartRecovery(dir)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(`T4.1 FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      process.exit(1);
    });
}
