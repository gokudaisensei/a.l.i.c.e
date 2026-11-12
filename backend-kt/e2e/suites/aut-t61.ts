// T6.1: create the same scene on both stacks, activate it, and compare what Home Assistant ends up
// with. The HA script ids differ per backend, so the meaningful comparison is behaviour, not YAML.
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { HttpClient } from "../lib/http.ts";
import { Recorder } from "../lib/record.ts";
import { makeRunDir } from "../lib/ids.ts";
import type { Side } from "../lib/scenario.ts";
import { BACKEND_URL } from "../env/constants.ts";
import { prepareWorlds } from "./scenario-support.ts";
import { devices, haFor, waitCommand } from "./cmd-support.ts";

interface SideResult {
  backend: string;
  sceneId: string | null;
  commands: number;
  confirmed: number;
  states: Record<string, string>;
}

export async function runSceneEquivalence(runDir: string): Promise<{ ts: SideResult; kt: SideResult; equal: boolean }> {
  const ctx = makeRunDir(runDir);
  const recorder = new Recorder(join(runDir, "evidence", "E2E-AUT-T61"));
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

  const worlds = await prepareWorlds(ctx, "ha", sides);
  const ha = haFor(sides.ts);

  const runOne = async (backend: "ts" | "kt"): Promise<SideResult> => {
    const admin = worlds[backend].actors.admin!;
    const list = await devices(admin);
    const sw = list.filter((d) => d.primary?.domain === "switch").slice(0, 2);
    const actions = sw.map((s) => ({ entityId: s.primary.entityId, action: "turn_off" }));
    const created = await admin.call(`t61.create.${backend}`, "POST", "/api/v1/scenes", {
      body: { name: `Parity T61 ${backend}`, actions },
    });
    if (created.status !== 200) throw new Error(`${backend}: scene create failed (${created.status})`);
    const id = (created.body as any)?.id as string;
    const activated = await admin.call(`t61.activate.${backend}`, "POST", `/api/v1/scenes/${id}/activate`, { body: {} });
    if (![200, 202].includes(activated.status)) throw new Error(`${backend}: scene activate failed (${activated.status})`);
    const commands = (((activated.body as any)?.commands ?? []) as any[]);
    let confirmed = 0;
    for (const cmd of commands) {
      const final = await waitCommand(admin, cmd.id);
      if (final.state === "confirmed") confirmed++;
    }
    const states: Record<string, string> = {};
    for (const s of sw) {
      const st = await ha.state(s.primary.entityId);
      states[s.primary.entityId] = st.state;
      await ha.callService("switch", "turn_on", { entity_id: s.primary.entityId });
    }
    await admin.call(`t61.delete.${backend}`, "DELETE", `/api/v1/scenes/${id}`);
    return { backend, sceneId: id, commands: commands.length, confirmed, states };
  };

  const ts = await runOne("ts");
  const kt = await runOne("kt");
  const keys = [...new Set([...Object.keys(ts.states), ...Object.keys(kt.states)])].sort();
  const equal = keys.every((k) => ts.states[k] === kt.states[k]);
  const out = { ts, kt, equal };
  writeFileSync(join(runDir, "aut-t61.json"), JSON.stringify(out, null, 2) + "\n");
  const md = [
    "# T6.1 scene equivalence",
    "",
    "| Check | TS | Kotlin |",
    "| --- | --- | --- |",
    `| commands started | ${ts.commands} | ${kt.commands} |`,
    `| commands confirmed | ${ts.confirmed} | ${kt.confirmed} |`,
    ...keys.map((k) => `| HA ${k} | ${ts.states[k] ?? "—"} | ${kt.states[k] ?? "—"} |`),
    "",
    `Behaviour is **${equal ? "identical" : "different"}** in Home Assistant.`,
    "",
  ].join("\n");
  writeFileSync(join(runDir, "aut-t61.md"), md);
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: bun suites/aut-t61.ts <run-dir>");
    process.exit(1);
  }
  runSceneEquivalence(dir)
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(`T6.1 FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      process.exit(1);
    });
}
