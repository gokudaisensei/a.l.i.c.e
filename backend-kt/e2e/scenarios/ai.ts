// AI cards — see cards/ai.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { devices, haFor } from "../suites/cmd-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

async function interpret(who: Actor, label: string, text: string): Promise<any[]> {
  const res = await who.call(label, "POST", "/api/v1/ai/interpret", { body: { text } });
  if (res.status !== 200) throw new Error(`${who.side.backend}: interpret failed (${res.status}): ${res.text.slice(0, 200)}`);
  return (((res.body as any)?.items ?? []) as any[]);
}

export const aiCards: CardDef[] = [
  {
    id: "E2E-AI-01",
    area: "AI",
    title: "A sentence becomes a proposal, not an action",
    capability: "POST /ai/interpret",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const lamp = list.find((d) => d.primary?.entityId === "light.living_room_rgbww_lights") ?? list.find((d) => d.primary?.domain === "light");
      const door = list.find((d) => d.primary?.entityId === "lock.front_door");
      const before = lamp ? await ha.state(lamp.primary.entityId) : null;

      const items = await interpret(admin, "ai.turn-off", "turn off the floor lamp");
      ctx.add("a command proposal is returned", items[0]?.kind === "commands", "commands", items[0]?.kind);
      ctx.add("the label names the device", typeof items[0]?.label === "string" && /floor lamp/i.test(items[0].label), "names Floor lamp", items[0]?.label);
      ctx.add("it is not sensitive", items[0]?.sensitive === false, false, items[0]?.sensitive);
      ctx.add("the plan turns the lamp off", items[0]?.plan?.commands?.[0]?.action === "turn_off", "turn_off", items[0]?.plan?.commands?.[0]?.action);

      const unlock = await interpret(admin, "ai.unlock", "unlock the front door");
      ctx.add("unlock is marked sensitive", unlock[0]?.sensitive === true, true, unlock[0]?.sensitive);
      ctx.add("the unlock plan is an unlock", unlock[0]?.plan?.commands?.[0]?.action === "unlock", "unlock", unlock[0]?.plan?.commands?.[0]?.action);

      const guestItems = await interpret(guest, "ai.guest", "turn off the floor lamp");
      ctx.add("a guest gets no proposals", guestItems.length === 0, 0, guestItems.length);

      if (lamp && before) {
        const after = await ha.state(lamp.primary.entityId);
        ctx.add("nothing ran", after.state === before.state, before.state, after.state);
      }
      void door;
    },
  },
  {
    id: "E2E-AI-02",
    area: "AI",
    title: "Scene names become proposals and nothing runs until picked",
    capability: "rules-first proposals",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const sw = list.find((d) => d.primary?.domain === "switch");
      ctx.add("a switch is available", sw !== undefined, "a switch", sw?.name);
      if (!sw) return;

      const scene = await admin.call("ai.scene.create", "POST", "/api/v1/scenes", {
        body: { name: "Parity movie night", actions: [{ entityId: sw.primary.entityId, action: "turn_off" }] },
      });
      ctx.expectStatus("ai.scene.create", scene, 200);
      const before = await ha.state(sw.primary.entityId);
      const items = await interpret(admin, "ai.scene", "parity movie night");
      ctx.add("the scene is proposed", items[0]?.kind === "scene", "scene", items[0]?.kind);
      const after = await ha.state(sw.primary.entityId);
      ctx.add("the proposal did not run", after.state === before.state, before.state, after.state);

      const empty = await interpret(admin, "ai.unknown", "flibbertigibbet");
      ctx.add("an unknown sentence yields no proposals", empty.length === 0, 0, empty.length);
      await admin.call("ai.scene.delete", "DELETE", `/api/v1/scenes/${(scene.body as any).id}`);
    },
  },
];
