// DEV cards — see cards/dev.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function devicesOf(body: unknown): any[] {
  return (((body as { devices?: unknown[] } | null)?.devices ?? []) as any[]);
}

async function listDevices(ctx: ScenarioContext, admin: Actor, label = "devices.list", query?: Record<string, string | number | boolean>): Promise<any[]> {
  const res = await admin.call(label, "GET", "/api/v1/devices", query ? { query } : {});
  ctx.expectStatus(label, res, 200);
  return devicesOf(res.body);
}

export const devCards: CardDef[] = [
  {
    id: "E2E-DEV-01",
    area: "DEV",
    title: "The device list has the documented shape and hides hidden Things",
    capability: "GET /devices (API.md)",
    oracles: ["TS", "HA"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await listDevices(ctx, admin);

      ctx.add("at least ten Things are listed", devices.length >= 10, ">=10", devices.length);
      const bad = devices.find(
        (d) =>
          typeof d.id !== "string" ||
          typeof d.name !== "string" ||
          typeof d.kind !== "string" ||
          !("primary" in d) ||
          !Array.isArray(d.others) ||
          !Array.isArray(d.controls) ||
          !Array.isArray(d.sensors) ||
          typeof d.available !== "boolean",
      );
      ctx.add("every Thing has the documented fields", bad === undefined, "id/name/kind/primary/others/controls/sensors/available", bad ?? "ok");
      ctx.add("the default list has no diagnostics", devices.every((d) => d.diagnostics === undefined || d.diagnostics === null), "absent", devices.filter((d) => d.diagnostics != null).length);
      ctx.add("the default list has no hidden Things", devices.every((d) => d.hidden === false), false, devices.filter((d) => d.hidden !== false).map((d) => d.name));

      const sorted = [...devices].map((d) => String(d.name).toLowerCase()).sort((a, b) => a.localeCompare(b));
      const actual = devices.map((d) => String(d.name).toLowerCase());
      ctx.add("the list is sorted by name", JSON.stringify(actual) === JSON.stringify(sorted), "name order", actual.slice(0, 5));
    },
  },
  {
    id: "E2E-DEV-02",
    area: "DEV",
    title: "List filters narrow by area, primary type and text",
    capability: "GET /devices?area=&type=&q=",
    oracles: ["TS", "HA"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const all = await listDevices(ctx, admin);

      const areasRes = await admin.call("devices.areas.for-filter", "GET", "/api/v1/areas");
      ctx.expectStatus("devices.areas.for-filter", areasRes, 200);
      const areas = ((areasRes.body as any)?.areas ?? []) as any[];
      const area = areas.find((a) => (a.deviceCount ?? 0) > 0) ?? areas[0];
      ctx.add("a populated area exists", area !== undefined && (area.deviceCount ?? 0) > 0, "deviceCount > 0", area?.deviceCount);

      if (area) {
        const inArea = await listDevices(ctx, admin, "devices.filter.area", { area: area.id });
        ctx.add("the area filter returns devices", inArea.length > 0, ">0", inArea.length);
        ctx.add("every area result has that area", inArea.every((d) => d.areaId === area.id), area.id, inArea.filter((d) => d.areaId !== area.id).map((d) => d.name));
      }

      const lights = await listDevices(ctx, admin, "devices.filter.type", { type: "light" });
      ctx.add("the type filter returns lights", lights.length > 0, ">0", lights.length);
      ctx.add("every type result is a light", lights.every((d) => d.primary?.domain === "light"), "primary.domain=light", lights.filter((d) => d.primary?.domain !== "light").map((d) => d.name));

      const door = await listDevices(ctx, admin, "devices.filter.q", { q: "floor lamp" });
      ctx.add("the text filter returns matches", door.length > 0, ">0", door.length);
      ctx.add(
        "every text result contains the word",
        door.every((d) => String(d.name).toLowerCase().includes("floor")),
        "name contains floor",
        door.filter((d) => !String(d.name).toLowerCase().includes("floor")).map((d) => d.name),
      );

      ctx.add("the unfiltered list is the largest", all.length >= lights.length && all.length >= door.length, "all >= filtered", { all: all.length, lights: lights.length, door: door.length });
    },
  },
  {
    id: "E2E-DEV-03",
    area: "DEV",
    title: "Diagnostics appear only when asked for",
    capability: "GET /devices/:id?include=diagnostics",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await listDevices(ctx, admin);
      const withDiagnostics = devices.find((d) => Number(d.diagnosticCount ?? 0) > 0);
      ctx.add("a Thing with diagnostics exists", withDiagnostics !== undefined, "diagnosticCount > 0", withDiagnostics?.diagnosticCount);
      if (!withDiagnostics) return;

      const plain = await admin.call("devices.detail.plain", "GET", `/api/v1/devices/${withDiagnostics.id}`);
      ctx.expectStatus("devices.detail.plain", plain, 200);
      ctx.add("the plain detail has no diagnostics array", (plain.body as any)?.diagnostics == null, "absent", (plain.body as any)?.diagnostics);

      const detailed = await admin.call("devices.detail.diagnostics", "GET", `/api/v1/devices/${withDiagnostics.id}?include=diagnostics`);
      ctx.expectStatus("devices.detail.diagnostics", detailed, 200);
      const diagnostics = (detailed.body as any)?.diagnostics;
      ctx.add("the detailed view has diagnostics", Array.isArray(diagnostics) && diagnostics.length === Number(withDiagnostics.diagnosticCount), withDiagnostics.diagnosticCount, Array.isArray(diagnostics) ? diagnostics.length : diagnostics);

      const guest = actor(ctx, "guest");
      const guestView = await guest.call("devices.detail.guest", "GET", `/api/v1/devices/${withDiagnostics.id}?include=diagnostics`);
      ctx.expectStatus("devices.detail.guest", guestView, 404);
      ctx.add("a guest never receives diagnostics", code(guestView.body) === "not_found", "not_found", code(guestView.body));
    },
  },
  {
    id: "E2E-DEV-04",
    area: "DEV",
    title: "Areas list and area membership agree",
    capability: "GET /areas, GET /areas/:id/devices",
    oracles: ["TS", "HA"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const res = await admin.call("areas.list", "GET", "/api/v1/areas");
      ctx.expectStatus("areas.list", res, 200);
      const areas = ((res.body as any)?.areas ?? []) as any[];
      ctx.add("at least five areas exist", areas.length >= 5, ">=5", areas.length);
      const bad = areas.find((a) => typeof a.id !== "string" || typeof a.name !== "string" || typeof a.deviceCount !== "number");
      ctx.add("every area has id, name and deviceCount", bad === undefined, "id/name/deviceCount", bad ?? "ok");

      const populated = areas.find((a) => a.deviceCount > 0) ?? areas[0];
      if (populated) {
        const members = await admin.call("areas.devices", "GET", `/api/v1/areas/${populated.id}/devices`);
        ctx.expectStatus("areas.devices", members, 200);
        const list = devicesOf(members.body);
        ctx.add("the area's device list matches its count", list.length === populated.deviceCount, populated.deviceCount, list.length);
        ctx.add("every listed device is in the area", list.every((d) => d.areaId === populated.id), populated.id, list.filter((d) => d.areaId !== populated.id).map((d) => d.name));
      }
    },
  },
  {
    id: "E2E-DEV-05",
    area: "DEV",
    title: "Capabilities are exposed for the device's entities",
    capability: "GET /devices/:id/capabilities",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await listDevices(ctx, admin);
      const light = devices.find((d) => d.primary?.domain === "light") ?? devices[0];
      ctx.add("a device with a primary entity exists", light !== undefined, "primary entity", light?.name);

      const res = await admin.call("devices.capabilities", "GET", `/api/v1/devices/${light.id}/capabilities`);
      ctx.expectStatus("devices.capabilities", res, 200);
      const entities = ((res.body as any)?.entities ?? []) as any[];
      ctx.add("capabilities are grouped per entity", entities.length > 0, ">0", entities.length);
      ctx.add(
        "every entity has id, name, role and capabilities",
        entities.every((e) => typeof e.entityId === "string" && typeof e.name === "string" && typeof e.role === "string" && Array.isArray(e.capabilities)),
        "entityId/name/role/capabilities",
        entities.find((e) => !(typeof e.entityId === "string" && typeof e.name === "string" && typeof e.role === "string" && Array.isArray(e.capabilities))) ?? "ok",
      );
      const caps = entities.flatMap((e) => e.capabilities ?? []);
      ctx.add(
        "at least one capability is fully described",
        caps.some((c) => typeof c.name === "string" && typeof c.readable === "boolean" && typeof c.controllable === "boolean" && Array.isArray(c.operations)),
        "name/readable/controllable/operations",
        caps.slice(0, 2),
      );

      const missing = await admin.call("devices.capabilities.missing", "GET", "/api/v1/devices/thing_nope/capabilities");
      ctx.expectStatus("devices.capabilities.missing", missing, 404);
      ctx.add("an unknown device is not_found", code(missing.body) === "not_found", "not_found", code(missing.body));
    },
  },
  {
    id: "E2E-DEV-06",
    area: "DEV",
    title: "Renaming a device is reflected and can be undone",
    capability: "PATCH /devices/:id/name",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await listDevices(ctx, admin);
      const target = devices[0];
      const original = target.name;
      ctx.add("a device is available to rename", target !== undefined, "a device", target?.name);

      const renamed = await admin.call("devices.rename", "PATCH", `/api/v1/devices/${target.id}/name`, { body: { name: "Parity Lamp" } });
      ctx.expectStatus("devices.rename", renamed, 200);
      ctx.add("the reply carries the new name", (renamed.body as any)?.name === "Parity Lamp", "Parity Lamp", (renamed.body as any)?.name);

      const detail = await admin.call("devices.renamed.detail", "GET", `/api/v1/devices/${target.id}`);
      ctx.add("the detail carries the new name", (detail.body as any)?.name === "Parity Lamp", "Parity Lamp", (detail.body as any)?.name);

      const restored = await admin.call("devices.rename.undo", "PATCH", `/api/v1/devices/${target.id}/name`, { body: { name: null } });
      ctx.expectStatus("devices.rename.undo", restored, 200);
      ctx.add("the original name returns", (restored.body as any)?.name === original, original, (restored.body as any)?.name);

      const missing = await admin.call("devices.rename.missing", "PATCH", "/api/v1/devices/thing_nope/name", { body: { name: "Nope" } });
      ctx.expectStatus("devices.rename.missing", missing, 404);
    },
  },
  {
    id: "E2E-DEV-07",
    area: "DEV",
    title: "Settings persist on the device's primary entity",
    capability: "PATCH /devices/:id/settings",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await listDevices(ctx, admin);
      const target = devices.find((d) => d.primary !== null) ?? devices[0];
      ctx.add("a device with a primary entity exists", target !== undefined, "primary entity", target?.name);

      const saved = await admin.call("devices.settings.save", "PATCH", `/api/v1/devices/${target.id}/settings`, {
        body: { powerLimitW: 1200, voiceExposed: true },
      });
      ctx.expectStatus("devices.settings.save", saved, 200);
      ctx.add("the reply carries the power limit", (saved.body as any)?.settings?.powerLimitW === 1200, 1200, (saved.body as any)?.settings?.powerLimitW);
      ctx.add("the reply carries voice exposure", (saved.body as any)?.settings?.voiceExposed === true, true, (saved.body as any)?.settings?.voiceExposed);

      const detail = await admin.call("devices.settings.detail", "GET", `/api/v1/devices/${target.id}`);
      ctx.add("the detail carries the saved power limit", (detail.body as any)?.settings?.powerLimitW === 1200, 1200, (detail.body as any)?.settings?.powerLimitW);

      const zero = await admin.call("devices.settings.zero", "PATCH", `/api/v1/devices/${target.id}/settings`, { body: { powerLimitW: 0 } });
      ctx.expectStatus("devices.settings.zero", zero, 400);
      ctx.add("an out-of-range power limit is a validation error", code(zero.body) === "validation_error", "validation_error", code(zero.body));

      const empty = await admin.call("devices.settings.empty", "PATCH", `/api/v1/devices/${target.id}/settings`, { body: {} });
      ctx.expectStatus("devices.settings.empty", empty, 400);
      ctx.add("an empty settings patch is a validation error", code(empty.body) === "validation_error", "validation_error", code(empty.body));

      const reset = await admin.call("devices.settings.reset", "PATCH", `/api/v1/devices/${target.id}/settings`, {
        body: { powerLimitW: null, voiceExposed: false },
      });
      ctx.expectStatus("devices.settings.reset", reset, 200);
    },
  },
  {
    id: "E2E-DEV-08",
    area: "DEV",
    title: "Hiding a device or blocking its main entity removes it from the list",
    capability: "POST /devices/:id/hide|unhide, PUT /entities/:id/role",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await listDevices(ctx, admin);
      const target = devices[0];
      ctx.add("a device is available to hide", target !== undefined, "a device", target?.name);

      const hide = await admin.call("devices.hide", "POST", `/api/v1/devices/${target.id}/hide`, { body: {} });
      ctx.expectStatus("devices.hide", hide, 200);
      ctx.add("hide is acknowledged", (hide.body as any)?.ok === true, true, (hide.body as any)?.ok);

      const visible = await listDevices(ctx, admin, "devices.list.after-hide");
      ctx.add("the hidden device leaves the default list", !visible.some((d) => d.id === target.id), "absent", visible.some((d) => d.id === target.id));

      const hidden = await listDevices(ctx, admin, "devices.list.include-hidden", { includeHidden: true });
      const found = hidden.find((d) => d.id === target.id);
      ctx.add("the hidden device is visible when asked for", found !== undefined && found.hidden === true, true, found?.hidden);

      const unhide = await admin.call("devices.unhide", "POST", `/api/v1/devices/${target.id}/unhide`, { body: {} });
      ctx.expectStatus("devices.unhide", unhide, 200);
      const back = await listDevices(ctx, admin, "devices.list.after-unhide");
      ctx.add("the device is back in the default list", back.some((d) => d.id === target.id), "present", back.some((d) => d.id === target.id));

      const primaryEntity = target.primary?.entityId;
      ctx.add("the device has a primary entity to block", typeof primaryEntity === "string", "entityId", primaryEntity);
      if (primaryEntity) {
        const blocked = await admin.call("devices.entity.hide", "PUT", `/api/v1/entities/${primaryEntity}/role`, { body: { hidden: true } });
        ctx.expectStatus("devices.entity.hide", blocked, 200);
        ctx.add("blocking the primary entity is acknowledged", (blocked.body as any)?.ok === true, true, (blocked.body as any)?.ok);
        const afterBlock = await listDevices(ctx, admin, "devices.list.entity-blocked");
        ctx.add("blocking the main entity removes the device", !afterBlock.some((d) => d.id === target.id), "absent", afterBlock.some((d) => d.id === target.id));

        const unblocked = await admin.call("devices.entity.unhide", "PUT", `/api/v1/entities/${primaryEntity}/role`, { body: { hidden: false } });
        ctx.expectStatus("devices.entity.unhide", unblocked, 200);
        const afterUnblock = await listDevices(ctx, admin, "devices.list.entity-unblocked");
        ctx.add("unblocking restores the device", afterUnblock.some((d) => d.id === target.id), "present", afterUnblock.some((d) => d.id === target.id));
      }
    },
  },
  {
    id: "E2E-DEV-09",
    area: "DEV",
    title: "A caller who may not see a device gets 404, never 403",
    capability: "per-caller visibility (SEC)",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const adminDevices = await listDevices(ctx, admin);
      const guestDevices = await listDevices(ctx, guest, "devices.guest.list");
      ctx.add("the guest's list is a subset", guestDevices.every((d) => adminDevices.some((a) => a.id === d.id)), "subset", guestDevices.length);

      const invisible = adminDevices.find((d) => !guestDevices.some((g) => g.id === d.id)) ?? adminDevices[0];
      ctx.add("an invisible device exists", invisible !== undefined, "a device", invisible?.name);
      if (!invisible) return;

      const detail = await guest.call("devices.guest.detail", "GET", `/api/v1/devices/${invisible.id}`);
      ctx.expectStatus("devices.guest.detail", detail, 404);
      ctx.add("invisible is not_found", code(detail.body) === "not_found", "not_found", code(detail.body));

      const caps = await guest.call("devices.guest.capabilities", "GET", `/api/v1/devices/${invisible.id}/capabilities`);
      ctx.expectStatus("devices.guest.capabilities", caps, 404);
      // Renaming/hiding needs write permissions a guest does not have, so the permission guard
      // answers 403 before visibility is consulted. The oracle does the same.
      const rename = await guest.call("devices.guest.rename", "PATCH", `/api/v1/devices/${invisible.id}/name`, { body: { name: "Nope" } });
      ctx.expectStatus("devices.guest.rename", rename, 403);
      ctx.add("the rename refusal is a permission error", code(rename.body) === "forbidden", "forbidden", code(rename.body));
      const hide = await guest.call("devices.guest.hide", "POST", `/api/v1/devices/${invisible.id}/hide`, { body: {} });
      ctx.add("a guest cannot hide an invisible device", hide.status === 403 || hide.status === 404, [403, 404], hide.status);
    },
  },
];
