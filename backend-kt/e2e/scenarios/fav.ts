// FAV cards — see cards/fav.md for the reviewed steps and coverage.
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

async function allDevices(admin: Actor): Promise<any[]> {
  const res = await admin.call("fav.devices", "GET", "/api/v1/devices");
  return devicesOf(res.body);
}

function names(devices: any[]): string[] {
  return devices.map((d) => String(d.name));
}

export const favCards: CardDef[] = [
  {
    id: "E2E-FAV-01",
    area: "FAV",
    title: "Favorites keep the caller's order and can be reordered or cleared",
    capability: "GET/PUT /favorites",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await allDevices(admin);
      const a = devices[0];
      const b = devices[1];
      ctx.add("two devices are available", a !== undefined && b !== undefined, "2 devices", devices.length);

      const first = await admin.call("fav.put.first", "PUT", "/api/v1/favorites", { body: { thingIds: [a.id, b.id] } });
      ctx.expectStatus("fav.put.first", first, 200);
      ctx.add("favorites come back in the requested order", JSON.stringify(devicesOf(first.body).map((d) => d.id)) === JSON.stringify([a.id, b.id]), [a.id, b.id], devicesOf(first.body).map((d) => d.id));

      const read = await admin.call("fav.get", "GET", "/api/v1/favorites");
      ctx.expectStatus("fav.get", read, 200);
      ctx.add("the stored order is stable", JSON.stringify(devicesOf(read.body).map((d) => d.id)) === JSON.stringify([a.id, b.id]), [a.id, b.id], devicesOf(read.body).map((d) => d.id));

      const reordered = await admin.call("fav.put.reordered", "PUT", "/api/v1/favorites", { body: { thingIds: [b.id, a.id] } });
      ctx.expectStatus("fav.put.reordered", reordered, 200);
      ctx.add("reordering is honoured", JSON.stringify(devicesOf(reordered.body).map((d) => d.id)) === JSON.stringify([b.id, a.id]), [b.id, a.id], devicesOf(reordered.body).map((d) => d.id));

      const cleared = await admin.call("fav.put.empty", "PUT", "/api/v1/favorites", { body: { thingIds: [] } });
      ctx.expectStatus("fav.put.empty", cleared, 200);
      ctx.add("clearing removes every favorite", devicesOf(cleared.body).length === 0, 0, devicesOf(cleared.body).length);
    },
  },
  {
    id: "E2E-FAV-02",
    area: "FAV",
    title: "Favorites are personal",
    capability: "per-user favorites",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const devices = await allDevices(admin);
      const a = devices[0];
      const b = devices[1];

      const adminPut = await admin.call("fav.admin.put", "PUT", "/api/v1/favorites", { body: { thingIds: [a.id] } });
      ctx.expectStatus("fav.admin.put", adminPut, 200);

      const memberRead = await member.call("fav.member.get", "GET", "/api/v1/favorites");
      ctx.expectStatus("fav.member.get", memberRead, 200);
      ctx.add("the member sees none of the admin's favorites", devicesOf(memberRead.body).length === 0, 0, devicesOf(memberRead.body).length);

      const memberPut = await member.call("fav.member.put", "PUT", "/api/v1/favorites", { body: { thingIds: [b.id] } });
      ctx.expectStatus("fav.member.put", memberPut, 200);
      const adminRead = await admin.call("fav.admin.get", "GET", "/api/v1/favorites");
      ctx.add("the admin's list is unchanged", JSON.stringify(devicesOf(adminRead.body).map((d) => d.id)) === JSON.stringify([a.id]), [a.id], devicesOf(adminRead.body).map((d) => d.id));
    },
  },
  {
    id: "E2E-FAV-03",
    area: "FAV",
    title: "The device list can be filtered to the caller's favorites",
    capability: "GET /devices?favorite=true",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await allDevices(admin);
      const a = devices[0];
      const b = devices[1];
      const c = devices[2];

      await admin.call("fav.put.for-filter", "PUT", "/api/v1/favorites", { body: { thingIds: [b.id, a.id] } });
      const filtered = await admin.call("fav.devices.filter", "GET", "/api/v1/devices?favorite=true");
      ctx.expectStatus("fav.devices.filter", filtered, 200);
      const favs = devicesOf(filtered.body);
      ctx.add("only favorites are returned", favs.length === 2 && favs.every((d) => d.id === a.id || d.id === b.id), "2 favorites", favs.map((d) => d.id));
      ctx.add("favorites are returned in favorite order", JSON.stringify(favs.map((d) => d.id)) === JSON.stringify([b.id, a.id]), [b.id, a.id], favs.map((d) => d.id));
      ctx.add("every favorite is flagged", favs.every((d) => d.favorite === true), true, favs.map((d) => d.favorite));

      const all = await admin.call("fav.devices.all", "GET", "/api/v1/devices");
      const other = devicesOf(all.body).find((d) => d.id === c.id);
      ctx.add("a non-favorite is flagged false", other?.favorite === false, false, other?.favorite);
    },
  },
  {
    id: "E2E-FAV-04",
    area: "FAV",
    title: "Unknown ids and too many favorites are refused",
    capability: "PUT /favorites validation",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const devices = await allDevices(admin);
      const a = devices[0];

      await admin.call("fav.put.seed", "PUT", "/api/v1/favorites", { body: { thingIds: [a.id] } });

      const unknown = await admin.call("fav.put.unknown", "PUT", "/api/v1/favorites", { body: { thingIds: ["thing_nope"] } });
      ctx.expectStatus("fav.put.unknown", unknown, 404);
      ctx.add("an unknown id is not_found", code(unknown.body) === "not_found", "not_found", code(unknown.body));

      const tooMany = await admin.call("fav.put.too-many", "PUT", "/api/v1/favorites", {
        body: { thingIds: Array.from({ length: 51 }, (_, i) => `thing_${i}`) },
      });
      ctx.expectStatus("fav.put.too-many", tooMany, [400, 422]);
      ctx.add("too many favorites are a validation error", code(tooMany.body) === "validation_error", "validation_error", code(tooMany.body));

      const read = await admin.call("fav.get.after-errors", "GET", "/api/v1/favorites");
      ctx.add("the previous favorites survive both failures", JSON.stringify(devicesOf(read.body).map((d) => d.id)) === JSON.stringify([a.id]), [a.id], devicesOf(read.body).map((d) => d.id));
    },
  },
  {
    id: "E2E-FAV-05",
    area: "FAV",
    title: "A device the caller cannot see cannot be a favorite",
    capability: "favorites × visibility",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const adminDevices = await allDevices(admin);
      const guestRead = await guest.call("fav.guest.list", "GET", "/api/v1/favorites");
      const guestDevices = await guest.call("fav.guest.devices", "GET", "/api/v1/devices");
      const visibleToGuest = new Set(devicesOf(guestDevices.body).map((d) => d.id));
      const invisible = adminDevices.find((d) => !visibleToGuest.has(d.id)) ?? adminDevices[0];
      ctx.add("an invisible device exists", invisible !== undefined, "a device", invisible?.name);

      const put = await guest.call("fav.guest.put.invisible", "PUT", "/api/v1/favorites", { body: { thingIds: [invisible.id] } });
      ctx.expectStatus("fav.guest.put.invisible", put, 404);
      ctx.add("an invisible favorite is not_found", code(put.body) === "not_found", "not_found", code(put.body));

      const after = await guest.call("fav.guest.list.after", "GET", "/api/v1/favorites");
      ctx.add("the guest's favorites stay empty", devicesOf(after.body).length === 0, 0, devicesOf(after.body).length);

      await admin.call("fav.admin.put", "PUT", "/api/v1/favorites", { body: { thingIds: [invisible.id] } });
      const hidden = await admin.call("fav.admin.hide", "POST", `/api/v1/devices/${invisible.id}/hide`, { body: {} });
      ctx.expectStatus("fav.admin.hide", hidden, 200);
      const filtered = await admin.call("fav.admin.after-hide", "GET", "/api/v1/favorites");
      ctx.add("a hidden device drops out of favorites", !devicesOf(filtered.body).some((d) => d.id === invisible.id), "absent", devicesOf(filtered.body).map((d) => d.name));
      await admin.call("fav.admin.unhide", "POST", `/api/v1/devices/${invisible.id}/unhide`, { body: {} });
      void guestRead;
    },
  },
  {
    id: "E2E-FAV-06",
    area: "FAV",
    title: "Groups create, list, rename, change members and delete",
    capability: "GET/POST/PATCH/DELETE /groups",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const lightsRes = await admin.call("groups.lights", "GET", "/api/v1/devices?type=light");
      const lights = devicesOf(lightsRes.body);
      const [a, b] = lights;
      ctx.add("two lights are available", a !== undefined && b !== undefined, "2 lights", lights.length);

      const created = await admin.call("groups.create", "POST", "/api/v1/groups", {
        body: { name: "Parity lights", thingIds: [a.id, b.id] },
      });
      ctx.expectStatus("groups.create", created, 200);
      const group = created.body as any;
      ctx.add("the group has an id and name", typeof group?.id === "string" && group?.name === "Parity lights", "id + Parity lights", { id: group?.id, name: group?.name });
      ctx.add("the group has both devices", Array.isArray(group?.devices) && group.devices.length === 2, 2, group?.devices?.length);
      const ids = new Set((group?.devices ?? []).map((d: any) => d.id));
      ctx.add("the group's devices are the requested ones", ids.has(a.id) && ids.has(b.id), [a.id, b.id], [...ids]);

      const list = await admin.call("groups.list", "GET", "/api/v1/groups");
      ctx.expectStatus("groups.list", list, 200);
      ctx.add("the group is listed", (((list.body as any)?.groups ?? []) as any[]).some((g) => g.id === group.id), true, (((list.body as any)?.groups ?? []) as any[]).map((g) => g.name));

      const read = await admin.call("groups.get", "GET", `/api/v1/groups/${group.id}`);
      ctx.expectStatus("groups.get", read, 200);
      ctx.add("the group detail matches", (read.body as any)?.name === "Parity lights", "Parity lights", (read.body as any)?.name);

      const updated = await admin.call("groups.update", "PATCH", `/api/v1/groups/${group.id}`, {
        body: { name: "Parity lamps", thingIds: [a.id] },
      });
      ctx.expectStatus("groups.update", updated, 200);
      ctx.add("the rename and member change apply", (updated.body as any)?.name === "Parity lamps" && ((updated.body as any)?.devices ?? []).length === 1, "Parity lamps + 1", { name: (updated.body as any)?.name, devices: ((updated.body as any)?.devices ?? []).length });

      const guestCreate = await guest.call("groups.guest.create", "POST", "/api/v1/groups", { body: { name: "Nope", thingIds: [a.id] } });
      ctx.expectStatus("groups.guest.create", guestCreate, 403);
      ctx.add("a guest cannot create a group", code(guestCreate.body) === "forbidden", "forbidden", code(guestCreate.body));

      const deleted = await admin.call("groups.delete", "DELETE", `/api/v1/groups/${group.id}`);
      ctx.expectStatus("groups.delete", deleted, 200);
      ctx.add("delete is acknowledged", (deleted.body as any)?.ok === true, true, (deleted.body as any)?.ok);

      const gone = await admin.call("groups.get.deleted", "GET", `/api/v1/groups/${group.id}`);
      ctx.expectStatus("groups.get.deleted", gone, 404);
      ctx.add("the deleted group is not_found", code(gone.body) === "not_found", "not_found", code(gone.body));
      void names;
    },
  },
];
