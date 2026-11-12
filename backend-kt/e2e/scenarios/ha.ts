// HA cards — see cards/ha.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { loadHaCreds, type HaCreds } from "../suites/scenario-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "household"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function creds(side: ScenarioContext["side"]): HaCreds {
  const c = loadHaCreds(side.runDir);
  if (!c) throw new Error("no ha-a.env in this run; run `bun env/up.ts --run-dir <this run>` first");
  return c;
}

export const haCards: CardDef[] = [
  {
    id: "E2E-HA-01",
    area: "HA",
    title: "An unconfigured install says so, and only admins may manage it",
    capability: "GET/PUT /ha/connection (API.md), permission ha.manage",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const ha = creds(ctx.side);

      const status = await admin.call("ha.status.unconfigured", "GET", "/api/v1/ha/connection");
      ctx.expectStatus("ha.status.unconfigured", status, 200);
      ctx.add(
        "the unconfigured body is exactly configured:false",
        JSON.stringify(status.body) === JSON.stringify({ configured: false }),
        { configured: false },
        status.body,
      );

      const memberGet = await member.call("ha.member.status", "GET", "/api/v1/ha/connection");
      ctx.expectStatus("ha.member.status", memberGet, 403);
      ctx.add("a member cannot read the connection", code(memberGet.body) === "forbidden", "forbidden", code(memberGet.body));

      const memberPut = await member.call("ha.member.put", "PUT", "/api/v1/ha/connection", {
        body: { baseUrl: ha.url, token: ha.token },
      });
      ctx.expectStatus("ha.member.put", memberPut, 403);
      ctx.add("a member cannot save the connection", code(memberPut.body) === "forbidden", "forbidden", code(memberPut.body));
    },
  },
  {
    id: "E2E-HA-02",
    area: "HA",
    title: "Saving a good connection reports it and never echoes the token",
    capability: "PUT /ha/connection with good credentials",
    oracles: ["TS", "HA"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = creds(ctx.side);

      const put = await admin.call("ha.connect.good", "PUT", "/api/v1/ha/connection", {
        body: { baseUrl: ha.url, token: ha.token },
      });
      ctx.expectStatus("ha.connect.good", put, 200);
      const body = put.body as Record<string, unknown>;
      ctx.add("the connection is configured", body.configured === true, true, body.configured);
      ctx.add("the connection is connected", body.status === "connected", "connected", body.status);
      ctx.add("the HA version is reported", body.haVersion === "2026.10.4", "2026.10.4", body.haVersion);
      ctx.add("the saved base URL is echoed", body.baseUrl === ha.url, ha.url, body.baseUrl);
      ctx.add("the token is not echoed", !put.text.includes(ha.token), "absent", "present");

      const status = await admin.call("ha.status.after-save", "GET", "/api/v1/ha/connection");
      ctx.expectStatus("ha.status.after-save", status, 200);
      const s = status.body as Record<string, unknown>;
      ctx.add("the saved connection is readable", s.configured === true && s.baseUrl === ha.url, true, s.configured);
    },
  },
  {
    id: "E2E-HA-03",
    area: "HA",
    title: "Bad targets are refused without saving anything",
    capability: "PUT /ha/connection validation",
    oracles: ["TS", "HA"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = creds(ctx.side);

      const wrongToken = await admin.call("ha.bad.token", "PUT", "/api/v1/ha/connection", {
        body: { baseUrl: ha.url, token: "bad-token-1234567890" },
      });
      ctx.expectStatus("ha.bad.token", wrongToken, 400);
      ctx.add("a rejected token is ha_token_rejected", code(wrongToken.body) === "ha_token_rejected", "ha_token_rejected", code(wrongToken.body));

      const notUrl = await admin.call("ha.bad.url", "PUT", "/api/v1/ha/connection", {
        body: { baseUrl: "not a url", token: ha.token },
      });
      ctx.expectStatus("ha.bad.url", notUrl, 400);
      ctx.add("a malformed URL is a validation error", code(notUrl.body) === "validation_error", "validation_error", code(notUrl.body));

      const ftp = await admin.call("ha.bad.scheme", "PUT", "/api/v1/ha/connection", {
        body: { baseUrl: "ftp://ha.local", token: ha.token },
      });
      ctx.expectStatus("ha.bad.scheme", ftp, 400);
      ctx.add("a non-http scheme is a validation error", code(ftp.body) === "validation_error", "validation_error", code(ftp.body));

      const linkLocal = await admin.call("ha.bad.link-local", "PUT", "/api/v1/ha/connection", {
        body: { baseUrl: "http://169.254.169.254/latest", token: ha.token },
      });
      ctx.expectStatus("ha.bad.link-local", linkLocal, 400);
      ctx.add("a link-local target is a validation error", code(linkLocal.body) === "validation_error", "validation_error", code(linkLocal.body));

      const status = await admin.call("ha.status.still-empty", "GET", "/api/v1/ha/connection");
      ctx.expectStatus("ha.status.still-empty", status, 200);
      ctx.add("nothing was saved", JSON.stringify(status.body) === JSON.stringify({ configured: false }), { configured: false }, status.body);
    },
  },
  {
    id: "E2E-HA-04",
    area: "HA",
    title: "The admin token is stored sealed and reported as set",
    capability: "PUT /ha/connection/admin-token",
    oracles: ["TS", "HA", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const ha = creds(ctx.side);

      const good = await admin.call("ha.admin-token.good", "PUT", "/api/v1/ha/connection/admin-token", {
        body: { token: ha.token },
      });
      ctx.expectStatus("ha.admin-token.good", good, 200);
      ctx.add("the admin token is accepted", (good.body as any)?.ok === true, true, (good.body as any)?.ok);

      const status = await admin.call("ha.status.admin-token", "GET", "/api/v1/ha/connection");
      ctx.add("the connection reports an admin token", (status.body as any)?.adminTokenSet === true, true, (status.body as any)?.adminTokenSet);

      const bad = await admin.call("ha.admin-token.bad", "PUT", "/api/v1/ha/connection/admin-token", {
        body: { token: "bad-admin-token-1234567890" },
      });
      ctx.expectStatus("ha.admin-token.bad", bad, 400);
      ctx.add("a rejected admin token is ha_token_rejected", code(bad.body) === "ha_token_rejected", "ha_token_rejected", code(bad.body));

      const memberPut = await member.call("ha.admin-token.member", "PUT", "/api/v1/ha/connection/admin-token", {
        body: { token: ha.token },
      });
      ctx.expectStatus("ha.admin-token.member", memberPut, 403);
    },
  },
  {
    id: "E2E-HA-05",
    area: "HA",
    title: "Resync discovers the seeded home",
    capability: "POST /ha/connection/resync; discovery",
    oracles: ["TS", "HA"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");

      const resync = await admin.call("ha.resync", "POST", "/api/v1/ha/connection/resync", { body: {} });
      ctx.expectStatus("ha.resync", resync, 200);
      ctx.add("the resync reports the entity count", typeof (resync.body as any)?.entities === "number" && (resync.body as any).entities >= 10, ">=10", (resync.body as any)?.entities);

      const status = await admin.call("ha.status.entities", "GET", "/api/v1/ha/connection");
      ctx.add("the status reports the entity count", typeof (status.body as any)?.entities === "number" && (status.body as any).entities >= 10, ">=10", (status.body as any)?.entities);

      const list = await admin.call("ha.devices.discovered", "GET", "/api/v1/devices");
      ctx.expectStatus("ha.devices.discovered", list, 200);
      const devices = ((list.body as any)?.devices ?? []) as any[];
      ctx.add("at least ten Things are visible", devices.length >= 10, ">=10", devices.length);
      const names = devices.map((d) => String(d.name));
      const has = (wanted: string) => names.some((n) => n.toLowerCase() === wanted.toLowerCase());
      for (const wanted of ["Floor lamp", "Front Door", "TV and console"]) {
        ctx.add(`the seeded ${wanted} is discovered`, has(wanted), wanted, has(wanted));
      }
      ctx.add(
        "every discovered Thing has its identifying fields",
        devices.every((d) => typeof d.id === "string" && typeof d.name === "string" && typeof d.kind === "string" && "primary" in d),
        "id/name/kind/primary",
        devices.find((d) => !(typeof d.id === "string" && typeof d.name === "string" && typeof d.kind === "string" && "primary" in d)) ?? "ok",
      );
    },
  },
  {
    id: "E2E-HA-06",
    area: "HA",
    title: "Deleting the connection drops the devices",
    capability: "DELETE /ha/connection",
    oracles: ["TS", "HA"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");

      const before = await admin.call("ha.devices.before-delete", "GET", "/api/v1/devices");
      ctx.add("devices existed before the delete", (((before.body as any)?.devices ?? []) as any[]).length >= 10, ">=10", ((before.body as any)?.devices ?? []).length);

      const del = await admin.call("ha.delete", "DELETE", "/api/v1/ha/connection");
      ctx.expectStatus("ha.delete", del, 200);
      ctx.add("the delete is acknowledged", (del.body as any)?.ok === true || (del.body as any)?.deleted === true, "ok/deleted", del.body);

      const status = await admin.call("ha.status.after-delete", "GET", "/api/v1/ha/connection");
      ctx.expectStatus("ha.status.after-delete", status, 200);
      ctx.add("the connection is gone", (status.body as any)?.configured === false, false, (status.body as any)?.configured);

      const after = await admin.call("ha.devices.after-delete", "GET", "/api/v1/devices");
      ctx.expectStatus("ha.devices.after-delete", after, 200);
      ctx.add("the device list is empty", (((after.body as any)?.devices ?? []) as any[]).length === 0, 0, ((after.body as any)?.devices ?? []).length);
    },
  },
];
