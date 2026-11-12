// HIST cards — see cards/hist.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { haFor } from "../suites/cmd-support.ts";
import { devices } from "../suites/cmd-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

const HELPERS = [
  ["input_number.parity_kettle_power", "sensor.parity_kettle_power", 1000],
  ["input_number.parity_tv_power", "sensor.parity_tv_power", 500],
  ["input_number.parity_washer_power", "sensor.parity_washer_power", 250],
] as const;

async function driveAll(ctx: ScenarioContext, reset = false, count = HELPERS.length): Promise<void> {
  const ha = haFor(ctx.side);
  for (const [helper, sensor, value] of HELPERS.slice(0, count)) {
    const v = reset ? 0 : value;
    await ha.callService("input_number", "set_value", { entity_id: helper, value: v });
    await ha.waitForState(sensor, (s) => Math.abs(Number(s.state) - v) <= 5, 15_000, 150);
  }
  if (reset) {
    for (const [helper] of HELPERS.slice(count)) {
      await ha.callService("input_number", "set_value", { entity_id: helper, value: 0 });
    }
  }
}

export const histCards: CardDef[] = [
  {
    id: "E2E-HIST-01",
    area: "HIST",
    title: "The live total follows the metering sensors",
    capability: "GET /energy/summary (T5.3)",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      await driveAll(ctx, false, 2);

      const res = await admin.call("hist.summary", "GET", "/api/v1/energy/summary");
      ctx.expectStatus("hist.summary", res, 200);
      const s = res.body as any;
      ctx.add("the live total includes the driven sensors", typeof s?.nowWatts === "number" && s.nowWatts >= 1500, ">=1500", s?.nowWatts);
      ctx.add("at least one meter is monitored", typeof s?.monitoredDevices === "number" && s.monitoredDevices > 0, ">0", s?.monitoredDevices);
      ctx.add("statistics availability is reported", typeof s?.statisticsAvailable === "boolean", "boolean", typeof s?.statisticsAvailable);
      ctx.add("topToday is an array", Array.isArray(s?.topToday), "array", Array.isArray(s?.topToday));

      const guestRes = await guest.call("hist.guest.summary", "GET", "/api/v1/energy/summary");
      ctx.expectStatus("hist.guest.summary", guestRes, 403);
      await driveAll(ctx, true);
    },
  },
  {
    id: "E2E-HIST-02",
    area: "HIST",
    title: "Per-device energy carries the power limit",
    capability: "GET /energy/devices",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const thing = list.find((d) => d.primary?.entityId === "sensor.parity_kettle_power");
      ctx.add("the kettle meter exists", thing !== undefined, "sensor.parity_kettle_power", thing?.name);
      if (!thing) return;

      const limit = await admin.call("hist.limit", "PATCH", `/api/v1/devices/${thing.id}/settings`, {
        body: { entityId: "sensor.parity_kettle_power", powerLimitW: 1600 },
      });
      ctx.expectStatus("hist.limit", limit, 200);
      await ha.callService("input_number", "set_value", { entity_id: "input_number.parity_kettle_power", value: 800 });
      await ha.waitForState("sensor.parity_kettle_power", (s) => Math.abs(Number(s.state) - 800) <= 5, 15_000, 150);

      const res = await admin.call("hist.devices", "GET", "/api/v1/energy/devices");
      ctx.expectStatus("hist.devices", res, 200);
      const row = (((res.body as any)?.devices ?? []) as any[]).find((d) => d.thingId === thing.id);
      ctx.add("the device row exists", row !== undefined, "a row", (((res.body as any)?.devices ?? []) as any[]).length);
      ctx.add("it reports the live watts", typeof row?.watts === "number" && Math.abs(row.watts - 800) <= 10, "800±10", row?.watts);
      ctx.add("it reports the limit", row?.limitW === 1600, 1600, row?.limitW);
      ctx.add("it reports the percentage", typeof row?.percentOfLimit === "number" && Math.abs(row.percentOfLimit - 50) <= 2, "50±2", row?.percentOfLimit);

      await admin.call("hist.limit.reset", "PATCH", `/api/v1/devices/${thing.id}/settings`, { body: { powerLimitW: null } });
      await ha.callService("input_number", "set_value", { entity_id: "input_number.parity_kettle_power", value: 0 });
    },
  },
  {
    id: "E2E-HIST-03",
    area: "HIST",
    title: "A device's state history is returned and validated",
    capability: "GET /history/devices/:id",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const target = list.find((d) => d.primary?.domain === "switch") ?? list[0];
      await ha.callService("switch", "turn_on", { entity_id: target.primary.entityId });
      await Bun.sleep(1200);

      const to = Date.now();
      const from = to - 3_600_000;
      const res = await admin.call("hist.history", "GET", `/api/v1/history/devices/${target.id}`, {
        query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      });
      ctx.expectStatus("hist.history", res, 200);
      const h = res.body as any;
      ctx.add("history has points", Array.isArray(h?.points) && h.totalPoints >= 1, ">=1", h?.totalPoints);
      ctx.add("the downsampled flag is a boolean", typeof h?.downsampled === "boolean", "boolean", typeof h?.downsampled);
      const point = (h?.points ?? [])[0];
      ctx.add("a point has at, state, values and availability", point !== undefined && "at" in point && "state" in point && "values" in point && "availability" in point, "at/state/values/availability", point ? Object.keys(point).sort() : "no points");

      const tooFew = await admin.call("hist.history.maxPoints", "GET", `/api/v1/history/devices/${target.id}?maxPoints=5`);
      ctx.expectStatus("hist.history.maxPoints", tooFew, [400, 422]);
      const badFrom = await admin.call("hist.history.bad-from", "GET", `/api/v1/history/devices/${target.id}?from=nope`);
      ctx.expectStatus("hist.history.bad-from", badFrom, 400);
      const guestRes = await guest.call("hist.history.guest", "GET", `/api/v1/history/devices/${target.id}`);
      ctx.expectStatus("hist.history.guest", guestRes, 403);
    },
  },
  {
    id: "E2E-HIST-04",
    area: "HIST",
    title: "Insights are listed and dismissible",
    capability: "GET /insights, POST /insights/:id/dismiss",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const res = await admin.call("hist.insights", "GET", "/api/v1/insights");
      ctx.expectStatus("hist.insights", res, 200);
      const insights = ((res.body as any)?.insights ?? []) as any[];
      ctx.add("insights is an array", Array.isArray((res.body as any)?.insights), "array", typeof (res.body as any)?.insights);
      const bad = insights.find((i) => typeof i.id !== "string" || typeof i.kind !== "string" || typeof i.title !== "string");
      ctx.add("every insight has the documented fields", bad === undefined, "id/kind/title", bad ?? "ok");

      const target = insights[0]?.id ?? "ins_nope";
      const dismiss = await admin.call("hist.insights.dismiss", "POST", `/api/v1/insights/${target}/dismiss`, { body: {} });
      ctx.expectStatus("hist.insights.dismiss", dismiss, 200);
      ctx.add("dismiss is acknowledged", (dismiss.body as any)?.ok === true, true, (dismiss.body as any)?.ok);

      const guestRes = await guest.call("hist.insights.guest", "GET", "/api/v1/insights");
      ctx.expectStatus("hist.insights.guest", guestRes, 403);
    },
  },
];
