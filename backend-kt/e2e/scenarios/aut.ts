// AUT cards — see cards/aut.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { HttpClient } from "../lib/http.ts";
import { devices, haFor, haState, sendCommand, waitCommand } from "../suites/cmd-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function switches(list: any[]): any[] {
  return list.filter((d) => d.primary?.domain === "switch");
}

async function restoreSwitches(ctx: ScenarioContext, list: any[]): Promise<void> {
  const ha = haFor(ctx.side);
  for (const s of switches(list)) await ha.callService("switch", "turn_on", { entity_id: s.primary.entityId });
}

function probe(admin: Actor): HttpClient {
  return new HttpClient(admin.side.baseUrl, admin.side.backend);
}

async function waitRun(admin: Actor, runId: string, timeoutMs = 20_000): Promise<any> {
  const start = Date.now();
  let last: any;
  while (Date.now() - start < timeoutMs) {
    const res = await probe(admin).request<any>("GET", `/api/v1/routines/runs/${runId}`, { cookie: admin.http.jar.header() });
    last = res.body;
    if (last?.state === "completed" || last?.state === "failed" || last?.state === "cancelled") return last;
    await Bun.sleep(200);
  }
  throw new Error(`${admin.side.backend}: routine run did not finish (last=${JSON.stringify(last)?.slice(0, 300)})`);
}

export const autCards: CardDef[] = [
  {
    id: "E2E-AUT-01",
    area: "AUT",
    title: "A scene saves, activates, edits and deletes",
    capability: "/scenes",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const sw = switches(list);
      ctx.add("two switches are available", sw.length >= 2, ">=2", sw.length);
      if (sw.length < 2) return;

      const actions = [
        { entityId: sw[0].primary.entityId, action: "turn_off" },
        { entityId: sw[1].primary.entityId, action: "turn_off" },
      ];
      const created = await admin.call("aut.scene.create", "POST", "/api/v1/scenes", { body: { name: "Parity movie", actions } });
      ctx.expectStatus("aut.scene.create", created, 200);
      const scene = created.body as any;
      ctx.add("the scene has both actions", Array.isArray(scene?.actions) && scene.actions.length === 2, 2, scene?.actions?.length);
      ctx.add("a new scene has not run", scene?.lastRunAt === null, null, scene?.lastRunAt);

      const listRes = await admin.call("aut.scene.list", "GET", "/api/v1/scenes");
      ctx.expectStatus("aut.scene.list", listRes, 200);
      ctx.add("the scene is listed", (((listRes.body as any)?.scenes ?? []) as any[]).some((s) => s.id === scene.id), true, (((listRes.body as any)?.scenes ?? []) as any[]).length);

      const read = await admin.call("aut.scene.get", "GET", `/api/v1/scenes/${scene.id}`);
      ctx.expectStatus("aut.scene.get", read, 200);
      ctx.add("the detail returns the actions", Array.isArray((read.body as any)?.actions) && (read.body as any).actions.length === 2, 2, (read.body as any)?.actions?.length);

      const activated = await admin.call("aut.scene.activate", "POST", `/api/v1/scenes/${scene.id}/activate`, { body: {} });
      ctx.expectStatus("aut.scene.activate", activated, [200, 202]);
      const commands = (((activated.body as any)?.commands ?? []) as any[]);
      ctx.add("activation starts both actions", commands.length === 2, 2, commands.length);
      ctx.add("nothing is skipped", (((activated.body as any)?.skipped ?? []) as any[]).length === 0, 0, (((activated.body as any)?.skipped ?? []) as any[]).length);
      for (const cmd of commands) {
        const final = await waitCommand(admin, cmd.id);
        ctx.add(`command ${cmd.id.slice(-4)} confirms`, final.state === "confirmed", "confirmed", final.state);
      }
      const offA = await haState(ha, sw[0].primary.entityId, (s) => s.state === "off");
      const offB = await haState(ha, sw[1].primary.entityId, (s) => s.state === "off");
      ctx.add("Home Assistant shows both off", offA.state === "off" && offB.state === "off", "off/off", `${offA.state}/${offB.state}`);

      const ran = await admin.call("aut.scene.after-run", "GET", `/api/v1/scenes/${scene.id}`);
      ctx.add("the last run time is set", typeof (ran.body as any)?.lastRunAt === "number", "number", (ran.body as any)?.lastRunAt);

      const updated = await admin.call("aut.scene.update", "PATCH", `/api/v1/scenes/${scene.id}`, { body: { name: "Parity cinema" } });
      ctx.expectStatus("aut.scene.update", updated, 200);
      ctx.add("the rename applies", (updated.body as any)?.name === "Parity cinema", "Parity cinema", (updated.body as any)?.name);

      const deleted = await admin.call("aut.scene.delete", "DELETE", `/api/v1/scenes/${scene.id}`);
      ctx.expectStatus("aut.scene.delete", deleted, 200);
      const gone = await admin.call("aut.scene.gone", "GET", `/api/v1/scenes/${scene.id}`);
      ctx.expectStatus("aut.scene.gone", gone, 404);
      await restoreSwitches(ctx, list);
    },
  },
  {
    id: "E2E-AUT-02",
    area: "AUT",
    title: "A routine runs its steps in order and reports progress",
    capability: "/routines, /routines/runs",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const target = switches(list)[0];
      ctx.add("a switch is available", target !== undefined, "a switch", target?.name);
      if (!target) return;

      const created = await admin.call("aut.routine.create", "POST", "/api/v1/routines", {
        body: {
          name: "Parity night",
          steps: [
            { type: "device", entityId: target.primary.entityId, action: "turn_off" },
            { type: "mode", mode: "night" },
          ],
        },
      });
      ctx.expectStatus("aut.routine.create", created, 200);
      const routine = created.body as any;
      ctx.add("the routine has two steps", Array.isArray(routine?.steps) && routine.steps.length === 2, 2, routine?.steps?.length);

      const executed = await admin.call("aut.routine.execute", "POST", `/api/v1/routines/${routine.id}/execute`, { body: {} });
      ctx.expectStatus("aut.routine.execute", executed, [200, 202]);
      const runId = (executed.body as any)?.id;
      ctx.add("execute returns a run", typeof runId === "string", "run id", runId);
      const final = await waitRun(admin, runId);
      ctx.add("the run completes", final.state === "completed", "completed", final.state);
      ctx.add("every step succeeded", ((final.steps ?? []) as any[]).every((s) => ["ok", "confirmed"].includes(s.state)), "ok", ((final.steps ?? []) as any[]).map((s) => s.state));

      const runs = await admin.call("aut.routine.runs", "GET", "/api/v1/routines/runs");
      ctx.expectStatus("aut.routine.runs", runs, 200);
      ctx.add("the run is listed", (((runs.body as any)?.runs ?? []) as any[]).some((r) => r.id === runId), true, (((runs.body as any)?.runs ?? []) as any[]).length);

      const off = await haState(ha, target.primary.entityId, (s) => s.state === "off");
      ctx.add("Home Assistant shows the switch off", off.state === "off", "off", off.state);
      const mode = await admin.call("aut.routine.mode", "GET", "/api/v1/household/mode");
      ctx.add("the mode step set night", (mode.body as any)?.mode === "night", "night", (mode.body as any)?.mode);

      await admin.call("aut.routine.reset-mode", "PUT", "/api/v1/household/mode", { body: { mode: "home" } });
      await ha.callService("switch", "turn_on", { entity_id: target.primary.entityId });
      await admin.call("aut.routine.delete", "DELETE", `/api/v1/routines/${routine.id}`);
    },
  },
  {
    id: "E2E-AUT-03",
    area: "AUT",
    title: "Household modes can be read and changed",
    capability: "/household/mode",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");

      const read = await admin.call("aut.mode.get", "GET", "/api/v1/household/mode");
      ctx.expectStatus("aut.mode.get", read, 200);
      ctx.add("the initial mode is home", (read.body as any)?.mode === "home", "home", (read.body as any)?.mode);

      const set = await admin.call("aut.mode.set", "PUT", "/api/v1/household/mode", { body: { mode: "night" } });
      ctx.expectStatus("aut.mode.set", set, 200);
      ctx.add("the mode changes", (set.body as any)?.mode === "night", "night", (set.body as any)?.mode);
      const after = await admin.call("aut.mode.after", "GET", "/api/v1/household/mode");
      ctx.add("the change is stored", (after.body as any)?.mode === "night", "night", (after.body as any)?.mode);

      const guestRead = await guest.call("aut.mode.guest.get", "GET", "/api/v1/household/mode");
      ctx.expectStatus("aut.mode.guest.get", guestRead, 200);
      const guestPut = await guest.call("aut.mode.guest.put", "PUT", "/api/v1/household/mode", { body: { mode: "away" } });
      ctx.expectStatus("aut.mode.guest.put", guestPut, 403);

      await admin.call("aut.mode.restore", "PUT", "/api/v1/household/mode", { body: { mode: "home" } });
    },
  },
  {
    id: "E2E-AUT-04",
    area: "AUT",
    title: "An automation previews, saves, validates and toggles",
    capability: "/automations",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const list = await devices(admin);
      const target = switches(list)[0];
      ctx.add("a switch is available", target !== undefined, "a switch", target?.name);
      if (!target) return;

      const definition = {
        version: 1,
        trigger: { type: "time", at: "22:30" },
        conditions: [],
        actions: [{ type: "device", entityId: target.primary.entityId, action: "turn_off" }],
      };
      const preview = await admin.call("aut.auto.preview", "POST", "/api/v1/automations/preview", { body: { name: "Parity preview", definition } });
      ctx.expectStatus("aut.auto.preview", preview, 200);
      ctx.add("the preview writes a sentence", typeof (preview.body as any)?.summary === "string" && (preview.body as any).summary.toLowerCase().includes("turn off"), "summary mentions turn off", (preview.body as any)?.summary);

      const created = await admin.call("aut.auto.create", "POST", "/api/v1/automations", { body: { name: "Parity automation", definition } });
      ctx.expectStatus("aut.auto.create", created, 200);
      const auto = created.body as any;
      ctx.add("the automation is enabled", auto?.enabled === true, true, auto?.enabled);
      ctx.add("without an admin token it is not synced", auto?.haAutomation?.status === "not_synced", "not_synced", auto?.haAutomation?.status);

      const listed = await admin.call("aut.auto.list", "GET", "/api/v1/automations");
      ctx.expectStatus("aut.auto.list", listed, 200);
      ctx.add("the automation is listed", (((listed.body as any)?.automations ?? []) as any[]).some((a) => a.id === auto.id), true, (((listed.body as any)?.automations ?? []) as any[]).length);
      const read = await admin.call("aut.auto.get", "GET", `/api/v1/automations/${auto.id}`);
      ctx.expectStatus("aut.auto.get", read, 200);

      const disabled = await admin.call("aut.auto.disable", "POST", `/api/v1/automations/${auto.id}/disable`, { body: {} });
      ctx.expectStatus("aut.auto.disable", disabled, 200);
      ctx.add("disable applies", (disabled.body as any)?.enabled === false, false, (disabled.body as any)?.enabled);
      const enabled = await admin.call("aut.auto.enable", "POST", `/api/v1/automations/${auto.id}/enable`, { body: {} });
      ctx.expectStatus("aut.auto.enable", enabled, 200);
      ctx.add("enable applies", (enabled.body as any)?.enabled === true, true, (enabled.body as any)?.enabled);

      const unknown = await admin.call("aut.auto.unknown", "POST", "/api/v1/automations", {
        body: { name: "Nope", definition: { ...definition, actions: [{ type: "device", entityId: "switch.nope", action: "turn_off" }] } },
      });
      ctx.expectStatus("aut.auto.unknown", unknown, [400, 404]);
      ctx.add("an unknown device is unknown_entity", code(unknown.body) === "unknown_entity", "unknown_entity", code(unknown.body));
      const malformed = await admin.call("aut.auto.malformed", "POST", "/api/v1/automations", { body: { name: "Nope", definition: { version: 1 } } });
      ctx.expectStatus("aut.auto.malformed", malformed, 400);
      ctx.add("a malformed definition is a validation error", code(malformed.body) === "validation_error", "validation_error", code(malformed.body));

      const guestList = await guest.call("aut.auto.guest", "GET", "/api/v1/automations");
      ctx.expectStatus("aut.auto.guest", guestList, 403);

      const deleted = await admin.call("aut.auto.delete", "DELETE", `/api/v1/automations/${auto.id}`);
      ctx.expectStatus("aut.auto.delete", deleted, 200);
      const gone = await admin.call("aut.auto.gone", "GET", `/api/v1/automations/${auto.id}`);
      ctx.expectStatus("aut.auto.gone", gone, 404);
      void sendCommand;
    },
  },
];
