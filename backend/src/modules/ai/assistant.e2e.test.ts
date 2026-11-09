import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, type World } from "../../testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const ask = async (b: typeof h.admin, text: string) => (await b.call("POST", "/ai/interpret", { text })).json.items as any[];

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("POST /ai/interpret", () => {
  test("reads a sentence against the real devices and runs nothing", async () => {
    const items = await ask(h.admin, "turn off the floor lamp");
    expect(items[0]).toMatchObject({ kind: "commands", label: "Turn off Floor lamp", sensitive: false });
    expect(items[0].plan.commands[0].action).toBe("turn_off");
    expect(w.gw.calls).toHaveLength(0);
  });
  test("the plan it offers can be run through the normal command path", async () => {
    const [it] = await ask(h.admin, "turn off the floor lamp");
    const c = it.plan.commands[0];
    const r = await h.admin.call("POST", `/devices/${c.thingId}/commands`, { action: c.action });
    expect(r.status).toBe(202);
  });
  test("it must be signed in; a guest only gets what they may see", async () => {
    expect((await w.browser().call("POST", "/ai/interpret", { text: "x" })).status).toBe(401);
    await h.admin.call("POST", "/scenes", { name: "Movie night", actions: [{ entityId: "light.floor_lamp", action: "turn_off" }] });
    expect((await ask(h.admin, "movie night"))[0]).toMatchObject({ kind: "scene" });
    const guest = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect(await ask(guest, "turn off the floor lamp")).toEqual([]);
    expect(await ask(guest, "night mode")).toEqual([]);
  });
});
