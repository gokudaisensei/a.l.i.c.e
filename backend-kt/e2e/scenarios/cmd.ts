// CMD cards — see cards/cmd.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";
import { countServiceCalls } from "../lib/ha-events.ts";
import { devices, findDevice, finishCmd, haFor, haState, sendCommand } from "../suites/cmd-support.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "ha"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function pct(brightness: number | undefined | null): number | null {
  return typeof brightness === "number" ? Math.round((brightness / 255) * 100) : null;
}

export const cmdCards: CardDef[] = [
  {
    id: "E2E-CMD-01",
    area: "CMD",
    title: "Power commands reach Home Assistant and confirm",
    capability: "POST /devices/:id/commands turn_off/turn_on",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const target = list.find((d) => d.primary?.domain === "switch") ?? findDevice(list, "Floor lamp");
      const entity = target.primary.entityId;
      const initial = await ha.state(entity);
      if (initial.state === "off") {
        const pre = await sendCommand(admin, "cmd.pre-on", target.id, "turn_on");
        await finishCmd(admin, (pre.body as any).id, "cmd.get.pre-on");
      }

      const off = await sendCommand(admin, "cmd.turn-off", target.id, "turn_off");
      ctx.expectStatus("cmd.turn-off", off, [200, 202]);
      ctx.add("the command has an id", typeof (off.body as any)?.id === "string", "id", (off.body as any)?.id);
      const offFinal = await finishCmd(admin, (off.body as any).id, "cmd.get.off");
      ctx.add("turn_off confirms", offFinal.state === "confirmed", "confirmed", offFinal.state);
      ctx.add("it was confirmed by observed state", offFinal.confirmedBy === "state", "state", offFinal.confirmedBy);
      ctx.add("the off command is undoable", offFinal.undoable === true, true, offFinal.undoable);
      const offHa = await haState(ha, entity, (s) => s.state === "off");
      ctx.add("Home Assistant shows the lamp off", offHa.state === "off", "off", offHa.state);

      const on = await sendCommand(admin, "cmd.turn-on", target.id, "turn_on");
      ctx.expectStatus("cmd.turn-on", on, [200, 202]);
      const onFinal = await finishCmd(admin, (on.body as any).id, "cmd.get.on");
      ctx.add("turn_on confirms", onFinal.state === "confirmed", "confirmed", onFinal.state);
      const onHa = await haState(ha, entity, (s) => s.state === "on");
      ctx.add("Home Assistant shows the lamp on", onHa.state === "on", "on", onHa.state);
    },
  },
  {
    id: "E2E-CMD-02",
    area: "CMD",
    title: "Brightness is applied and out-of-range values fail",
    capability: "set_brightness",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const lamp = findDevice(await devices(admin), "Floor lamp");
      const entity = lamp.primary.entityId;
      const before = await ha.state(entity);
      const prev = before.attributes.brightness as number | undefined;

      const set = await sendCommand(admin, "cmd.brightness", lamp.id, "set_brightness", { brightness_pct: 40 });
      ctx.expectStatus("cmd.brightness", set, [200, 202]);
      const setFinal = await finishCmd(admin, (set.body as any).id, "cmd.get.brightness");
      ctx.add("the brightness command confirms", setFinal.state === "confirmed", "confirmed", setFinal.state);

      const after = await haState(ha, entity, (s) => {
        const v = pct(s.attributes.brightness as number);
        return v !== null && Math.abs(v - 40) <= 2;
      });
      const now = pct(after.attributes.brightness as number);
      ctx.add("Home Assistant is at 40 percent", now !== null && Math.abs(now - 40) <= 2, "40±2", now);

      const zero = await sendCommand(admin, "cmd.brightness.zero", lamp.id, "set_brightness", { brightness_pct: 0 });
      ctx.expectStatus("cmd.brightness.zero", zero, [200, 202]);
      const zeroFinal = await finishCmd(admin, (zero.body as any).id, "cmd.get.brightness.zero");
      ctx.add("zero brightness is a failed command", zeroFinal.state === "failed", "failed", zeroFinal.state);
      ctx.add("zero brightness is invalid_parameters", zeroFinal.failure?.code === "invalid_parameters", "invalid_parameters", zeroFinal.failure?.code);

      if (prev !== undefined) {
        const restore = await sendCommand(admin, "cmd.brightness.restore", lamp.id, "set_brightness", { brightness_pct: pct(prev) });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.brightness.restore");
      } else {
        const restore = await sendCommand(admin, "cmd.brightness.restore-off", lamp.id, "turn_off");
        await finishCmd(admin, (restore.body as any).id, "cmd.get.brightness.restore");
      }
    },
  },
  {
    id: "E2E-CMD-03",
    area: "CMD",
    title: "Color temperature is applied",
    capability: "set_color_temperature {kelvin}",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const lamp = list.find((d) => d.primary?.entityId === "light.bed_light") ?? findDevice(list, "Bedside lamps");
      const entity = lamp.primary.entityId;
      const before = await ha.state(entity);
      const prevKelvin = before.attributes.color_temp_kelvin as number | undefined;
      const prevRgb = before.attributes.rgb_color as number[] | undefined;

      const set = await sendCommand(admin, "cmd.kelvin", lamp.id, "set_color_temperature", { kelvin: 3000 });
      ctx.expectStatus("cmd.kelvin", set, [200, 202]);
      const setFinal = await finishCmd(admin, (set.body as any).id, "cmd.get.kelvin");
      ctx.add("the color-temperature command confirms", setFinal.state === "confirmed", "confirmed", setFinal.state);

      const after = await haState(ha, entity, (s) => {
        const k = s.attributes.color_temp_kelvin as number | undefined;
        return typeof k === "number" && Math.abs(k - 3000) <= 60;
      });
      ctx.add("Home Assistant is at 3000K", Math.abs((after.attributes.color_temp_kelvin as number) - 3000) <= 60, "3000±60", after.attributes.color_temp_kelvin);

      if (prevKelvin !== undefined) {
        const restore = await sendCommand(admin, "cmd.kelvin.restore", lamp.id, "set_color_temperature", { kelvin: prevKelvin });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.kelvin.restore");
      } else if (prevRgb) {
        const restore = await sendCommand(admin, "cmd.kelvin.restore-rgb", lamp.id, "set_color", { rgb: prevRgb });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.kelvin.restore");
      }
    },
  },
  {
    id: "E2E-CMD-04",
    area: "CMD",
    title: "Fan speed is applied within the fan's step",
    capability: "set_speed {percentage}",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const fan = findDevice(await devices(admin), "Ceiling fan");
      const entity = fan.primary.entityId;
      const before = await ha.state(entity);
      const prev = before.attributes.percentage as number | undefined;

      const set = await sendCommand(admin, "cmd.fan", fan.id, "set_speed", { percentage: 50 });
      ctx.expectStatus("cmd.fan", set, [200, 202]);
      const setFinal = await finishCmd(admin, (set.body as any).id, "cmd.get.fan");
      ctx.add("the fan command confirms", setFinal.state === "confirmed", "confirmed", setFinal.state);

      const after = await haState(ha, entity, (s) => {
        const p = s.attributes.percentage as number | undefined;
        return typeof p === "number" && Math.abs(p - 50) <= 34;
      });
      ctx.add("Home Assistant is near 50 percent", Math.abs((after.attributes.percentage as number) - 50) <= 34, "50±34", after.attributes.percentage);

      if (prev !== undefined) {
        const restore = await sendCommand(admin, "cmd.fan.restore", fan.id, "set_speed", { percentage: prev });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.fan.restore");
      } else {
        const restore = await sendCommand(admin, "cmd.fan.restore-off", fan.id, "turn_off");
        await finishCmd(admin, (restore.body as any).id, "cmd.get.fan.restore");
      }
    },
  },
  {
    id: "E2E-CMD-05",
    area: "CMD",
    title: "Climate target temperature is applied",
    capability: "set_temperature {temperature}",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const climate = list.find((d) => d.primary?.entityId === "climate.heatpump") ?? findDevice(list, "AC");
      const entity = climate.primary.entityId;
      const before = await ha.state(entity);
      const prev = before.attributes.temperature as number | undefined;

      const set = await sendCommand(admin, "cmd.climate", climate.id, "set_temperature", { temperature: 22 });
      ctx.expectStatus("cmd.climate", set, [200, 202]);
      const setFinal = await finishCmd(admin, (set.body as any).id, "cmd.get.climate");
      ctx.add("the climate command confirms", setFinal.state === "confirmed", "confirmed", setFinal.state);

      const after = await haState(ha, entity, (s) => {
        const t = s.attributes.temperature as number | undefined;
        return typeof t === "number" && Math.abs(t - 22) <= 0.5;
      });
      ctx.add("Home Assistant targets 22", Math.abs((after.attributes.temperature as number) - 22) <= 0.5, "22±0.5", after.attributes.temperature);

      if (prev !== undefined) {
        const restore = await sendCommand(admin, "cmd.climate.restore", climate.id, "set_temperature", { temperature: prev });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.climate.restore");
      }
    },
  },
  {
    id: "E2E-CMD-06",
    area: "CMD",
    title: "Cover position is applied",
    capability: "set_position {position}",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const cover = findDevice(await devices(admin), "Balcony door");
      const entity = cover.primary.entityId;
      const before = await ha.state(entity);
      const prev = before.attributes.current_position as number | undefined;

      const set = await sendCommand(admin, "cmd.cover", cover.id, "set_position", { position: 30 });
      ctx.expectStatus("cmd.cover", set, [200, 202]);
      const setFinal = await finishCmd(admin, (set.body as any).id, "cmd.get.cover");
      ctx.add("the cover command confirms", setFinal.state === "confirmed", "confirmed", setFinal.state);

      const after = await haState(ha, entity, (s) => {
        const p = s.attributes.current_position as number | undefined;
        return typeof p === "number" && Math.abs(p - 30) <= 2;
      });
      ctx.add("Home Assistant is at 30 percent", Math.abs((after.attributes.current_position as number) - 30) <= 2, "30±2", after.attributes.current_position);

      if (prev !== undefined) {
        const restore = await sendCommand(admin, "cmd.cover.restore", cover.id, "set_position", { position: prev });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.cover.restore");
      } else {
        const restore = await sendCommand(admin, "cmd.cover.open", cover.id, "open");
        await finishCmd(admin, (restore.body as any).id, "cmd.get.cover.restore");
      }
    },
  },
  {
    id: "E2E-CMD-07",
    area: "CMD",
    title: "Lock and unlock change HA, and a guest cannot control the door",
    capability: "lock, unlock; step-up rules",
    oracles: ["HA", "TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const guest = actor(ctx, "guest");
      const ha = haFor(ctx.side);
      const door = findDevice(await devices(admin), "Front Door");
      const entity = door.primary.entityId;

      const unlock = await sendCommand(admin, "cmd.unlock", door.id, "unlock");
      ctx.expectStatus("cmd.unlock", unlock, [200, 202]);
      const unlockFinal = await finishCmd(admin, (unlock.body as any).id, "cmd.get.unlock");
      ctx.add("unlock confirms", unlockFinal.state === "confirmed", "confirmed", unlockFinal.state);
      const unlocked = await haState(ha, entity, (s) => s.state === "unlocked");
      ctx.add("Home Assistant shows the door unlocked", unlocked.state === "unlocked", "unlocked", unlocked.state);

      const lock = await sendCommand(admin, "cmd.lock", door.id, "lock");
      ctx.expectStatus("cmd.lock", lock, [200, 202]);
      await finishCmd(admin, (lock.body as any).id, "cmd.get.lock");
      const locked = await haState(ha, entity, (s) => s.state === "locked");
      ctx.add("Home Assistant shows the door locked", locked.state === "locked", "locked", locked.state);

      const guestTry = await guest.call("cmd.guest.unlock", "POST", `/api/v1/devices/${door.id}/commands`, { body: { action: "unlock" } });
      ctx.add("a guest cannot unlock the door", guestTry.status === 403 || guestTry.status === 404, [403, 404], guestTry.status);
      const still = await ha.state(entity);
      ctx.add("the door is still locked", still.state === "locked", "locked", still.state);
    },
  },
  {
    id: "E2E-CMD-08",
    area: "CMD",
    title: "Media player power is applied",
    capability: "media_player turn_on/turn_off",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const player = list.find((d) => d.primary?.domain === "media_player");
      ctx.add("a media player is available", player !== undefined, "media_player", player?.name);
      if (!player) return;
      const entity = player.primary.entityId;
      const before = await ha.state(entity);

      const off = await sendCommand(admin, "cmd.media.off", player.id, "turn_off");
      ctx.expectStatus("cmd.media.off", off, [200, 202]);
      const offFinal = await finishCmd(admin, (off.body as any).id, "cmd.get.media.off");
      ctx.add("media turn_off confirms", offFinal.state === "confirmed", "confirmed", offFinal.state);
      const offHa = await haState(ha, entity, (s) => s.state === "off");
      ctx.add("Home Assistant shows the player off", offHa.state === "off", "off", offHa.state);

      const on = await sendCommand(admin, "cmd.media.on", player.id, "turn_on");
      ctx.expectStatus("cmd.media.on", on, [200, 202]);
      await finishCmd(admin, (on.body as any).id, "cmd.get.media.on");
      const onHa = await haState(ha, entity, (s) => s.state !== "off");
      ctx.add("Home Assistant shows the player on", onHa.state !== "off", "not off", onHa.state);

      if (before.state === "off") {
        const restore = await sendCommand(admin, "cmd.media.restore", player.id, "turn_off");
        await finishCmd(admin, (restore.body as any).id, "cmd.get.media.restore");
      }
    },
  },
  {
    id: "E2E-CMD-09",
    area: "CMD",
    title: "Refusals are failed commands with fixed text",
    capability: "command failure codes and messages",
    oracles: ["TS", "SEC"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const list = await devices(admin);
      const lamp = findDevice(list, "Floor lamp");
      const climate = findDevice(list, "Living AC");

      const unsupported = await sendCommand(admin, "cmd.invalid.action", lamp.id, "do_a_backflip");
      ctx.expectStatus("cmd.invalid.action", unsupported, [200, 202]);
      const unsupportedFinal = await finishCmd(admin, (unsupported.body as any).id, "cmd.get.invalid.action");
      ctx.add("an unsupported operation fails", unsupportedFinal.state === "failed", "failed", unsupportedFinal.state);
      ctx.add("the code is unsupported_operation", unsupportedFinal.failure?.code === "unsupported_operation", "unsupported_operation", unsupportedFinal.failure?.code);

      for (const [label, value] of [["zero", 0], ["text", "ten"]] as const) {
        const bad = await sendCommand(admin, `cmd.invalid.params.${label}`, lamp.id, "set_brightness", { brightness_pct: value });
        ctx.expectStatus(`cmd.invalid.params.${label}`, bad, [200, 202]);
        const final = await finishCmd(admin, (bad.body as any).id, `cmd.get.invalid.params.${label}`);
        ctx.add(`the ${label} parameter fails`, final.state === "failed", "failed", final.state);
        ctx.add(`the ${label} parameter is invalid_parameters`, final.failure?.code === "invalid_parameters", "invalid_parameters", final.failure?.code);
      }

      const rejected = await sendCommand(admin, "cmd.ha.rejected", climate.id, "set_hvac_mode", { hvac_mode: "nonsense" });
      ctx.expectStatus("cmd.ha.rejected", rejected, [200, 202]);
      const rejectedFinal = await finishCmd(admin, (rejected.body as any).id, "cmd.get.ha.rejected");
      ctx.add("an HA refusal fails the command", rejectedFinal.state === "failed", "failed", rejectedFinal.state);
      ctx.add("an HA refusal is ha_rejected", rejectedFinal.failure?.code === "ha_rejected", "ha_rejected", rejectedFinal.failure?.code);
      ctx.add("the HA refusal text is fixed", rejectedFinal.failure?.message === "Home Assistant refused the command", "Home Assistant refused the command", rejectedFinal.failure?.message);
    },
  },
  {
    id: "E2E-CMD-10",
    area: "CMD",
    title: "The idempotency-key matrix",
    capability: "Idempotency-Key",
    oracles: ["TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const list = await devices(admin);
      const target = list.find((d) => d.primary?.domain === "switch") ?? findDevice(list, "Floor lamp");
      const key = "parity-cmd-key-0001";

      const first = await sendCommand(admin, "cmd.idem.first", target.id, "turn_off", undefined, key);
      ctx.expectStatus("cmd.idem.first", first, [200, 202]);
      const second = await sendCommand(admin, "cmd.idem.replay", target.id, "turn_off", undefined, key);
      ctx.expectStatus("cmd.idem.replay", second, [200, 202]);
      ctx.add("the replay returns the same command", (second.body as any)?.id === (first.body as any)?.id, (first.body as any)?.id, (second.body as any)?.id);
      ctx.add("the replay is flagged", second.headers["idempotent-replay"] === "true", "true", second.headers["idempotent-replay"] ?? "<missing>");

      const different = await sendCommand(admin, "cmd.idem.different", target.id, "turn_on", undefined, key);
      ctx.expectStatus("cmd.idem.different", different, 422);
      ctx.add("the same key with a different request is refused", code(different.body) === "idempotency_key_reuse", "idempotency_key_reuse", code(different.body));

      const bad = await sendCommand(admin, "cmd.idem.bad-key", target.id, "turn_off", undefined, "short");
      ctx.expectStatus("cmd.idem.bad-key", bad, 400);
      ctx.add("a bad key is a validation error", code(bad.body) === "validation_error", "validation_error", code(bad.body));

      const memberSend = await sendCommand(member, "cmd.idem.member", target.id, "turn_off", undefined, key);
      ctx.expectStatus("cmd.idem.member", memberSend, [200, 202]);
      ctx.add("keys belong to the person", (memberSend.body as any)?.id !== (first.body as any)?.id, "different id", (memberSend.body as any)?.id === (first.body as any)?.id);

      await finishCmd(admin, (first.body as any).id, "cmd.get.idem.first");
      const restore = await sendCommand(admin, "cmd.idem.restore", target.id, "turn_on");
      await finishCmd(admin, (restore.body as any).id, "cmd.get.idem.restore");
    },
  },
  {
    id: "E2E-CMD-11",
    area: "CMD",
    title: "Undo puts the previous state back once",
    capability: "POST /commands/:id/undo",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const target = list.find((d) => d.primary?.domain === "switch") ?? findDevice(list, "Floor lamp");
      const entity = target.primary.entityId;
      const initial = await ha.state(entity);
      if (initial.state === "off") {
        const pre = await sendCommand(admin, "cmd.undo.pre-on", target.id, "turn_on");
        await finishCmd(admin, (pre.body as any).id, "cmd.get.undo.pre-on");
      }

      const off = await sendCommand(admin, "cmd.undo.off", target.id, "turn_off");
      ctx.expectStatus("cmd.undo.off", off, [200, 202]);
      const offId = (off.body as any).id;
      const offFinal = await finishCmd(admin, offId, "cmd.get.undo.off");
      ctx.add("the original command is undoable", offFinal.undoable === true, true, offFinal.undoable);

      const undo = await admin.call("cmd.undo", "POST", `/api/v1/commands/${offId}/undo`, { body: {} });
      ctx.expectStatus("cmd.undo", undo, [200, 202]);
      ctx.add("undo turns the lamp back on", (undo.body as any)?.action === "turn_on", "turn_on", (undo.body as any)?.action);
      ctx.add("undo points at the original", (undo.body as any)?.undoOf === offId, offId, (undo.body as any)?.undoOf);
      const undoFinal = await finishCmd(admin, (undo.body as any).id, "cmd.get.undo");
      ctx.add("the undo command confirms", undoFinal.state === "confirmed", "confirmed", undoFinal.state);
      const onHa = await haState(ha, entity, (s) => s.state === "on");
      ctx.add("Home Assistant shows the lamp on", onHa.state === "on", "on", onHa.state);

      const again = await admin.call("cmd.undo.again", "POST", `/api/v1/commands/${offId}/undo`, { body: {} });
      ctx.expectStatus("cmd.undo.again", again, [400, 409, 422]);
      ctx.add("undoing twice is refused", code(again.body) === "already_undone", "already_undone", code(again.body));

      const undoOfUndo = await admin.call("cmd.undo.of-undo", "POST", `/api/v1/commands/${(undo.body as any).id}/undo`, { body: {} });
      ctx.expectStatus("cmd.undo.of-undo", undoOfUndo, [400, 409, 422]);
      ctx.add("undo of an undo is refused", code(undoOfUndo.body) === "not_undoable", "not_undoable", code(undoOfUndo.body));

      const offAgain = await sendCommand(admin, "cmd.undo.off-again", target.id, "turn_off");
      const other = await member.call("cmd.undo.someone-else", "POST", `/api/v1/commands/${(offAgain.body as any).id}/undo`, { body: {} });
      ctx.expectStatus("cmd.undo.someone-else", other, 404);
      const restore = await sendCommand(admin, "cmd.undo.restore", target.id, "turn_on");
      await finishCmd(admin, (restore.body as any).id, "cmd.get.undo.restore");
    },
  },
  {
    id: "E2E-CMD-12",
    area: "CMD",
    title: "Coalescing keeps the last brightness and preserves order",
    capability: "T4.2 coalescing / per-entity ordering",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const lamp = findDevice(await devices(admin), "Floor lamp");
      const entity = lamp.primary.entityId;
      const before = await ha.state(entity);
      const prev = before.attributes.brightness as number | undefined;

      const counter = await countServiceCalls(ha, entity);
      const ids: string[] = [];
      const created: number[] = [];
      try {
        for (let p = 10; p <= 54; p++) {
          const r = await sendCommand(admin, `cmd.burst.${p}`, lamp.id, "set_brightness", { brightness_pct: p });
          ctx.expectStatus(`cmd.burst.${p}`, r, [200, 202]);
          ids.push((r.body as any).id);
          created.push((r.body as any).createdAt);
        }
      } finally {
        // stop counting after the last request, then wait for the pipeline to settle
      }
      const finals = [] as any[];
      for (const id of ids) finals.push(await finishCmd(admin, id, `cmd.get.burst.${id.slice(-4)}`));
      const count = counter.count();
      counter.stop();

      ctx.add("every burst command reached a terminal state", finals.every((f) => ["confirmed", "failed", "cancelled"].includes(f.state)), "terminal", finals.map((f) => f.state));
      const after = await haState(ha, entity, (s) => {
        const v = pct(s.attributes.brightness as number);
        return v !== null && Math.abs(v - 54) <= 2;
      });
      const now = pct(after.attributes.brightness as number);
      ctx.add("Home Assistant keeps the last value", now !== null && Math.abs(now - 54) <= 2, "54±2", now);
      ctx.add("the commands were created in order", created.every((t, i) => i === 0 || t >= created[i - 1]!), "monotonic", created);
      ctx.add("HA received at least one service call", count >= 1, ">=1", count);

      if (prev !== undefined) {
        const restore = await sendCommand(admin, "cmd.burst.restore", lamp.id, "set_brightness", { brightness_pct: pct(prev) });
        await finishCmd(admin, (restore.body as any).id, "cmd.get.burst.restore");
      } else {
        const restore = await sendCommand(admin, "cmd.burst.restore-off", lamp.id, "turn_off");
        await finishCmd(admin, (restore.body as any).id, "cmd.get.burst.restore");
      }
    },
  },
  {
    id: "E2E-CMD-13",
    area: "CMD",
    title: "A group command fans out to its members",
    capability: "POST /groups/:id/commands",
    oracles: ["HA", "TS"],
    world: "ha",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const ha = haFor(ctx.side);
      const list = await devices(admin);
      const a = findDevice(list, "Floor lamp");
      const b = findDevice(list, "Bedside lamps");
      ctx.add("two lights are available", a !== undefined && b !== undefined, "2 lights", list.filter((d) => d.primary?.domain === "light").length);

      const created = await admin.call("cmd.group.create", "POST", "/api/v1/groups", { body: { name: "Parity command group", thingIds: [a.id, b.id] } });
      ctx.expectStatus("cmd.group.create", created, 200);
      const groupId = (created.body as any)?.id;

      const off = await admin.call("cmd.group.off", "POST", `/api/v1/groups/${groupId}/commands`, { body: { action: "turn_off" } });
      ctx.expectStatus("cmd.group.off", off, [200, 202]);
      const offBody = off.body as any;
      ctx.add("the group command fans out", Array.isArray(offBody?.commands) && offBody.commands.length === 2, 2, offBody?.commands?.length);
      for (const cmd of offBody?.commands ?? []) await finishCmd(admin, cmd.id, `cmd.get.group.${cmd.id.slice(-4)}`);
      const offA = await haState(ha, a.primary.entityId, (s) => s.state === "off");
      const offB = await haState(ha, b.primary.entityId, (s) => s.state === "off");
      ctx.add("both lights are off", offA.state === "off" && offB.state === "off", "off/off", `${offA.state}/${offB.state}`);

      const on = await admin.call("cmd.group.on", "POST", `/api/v1/groups/${groupId}/commands`, { body: { action: "turn_on" } });
      ctx.expectStatus("cmd.group.on", on, [200, 202]);
      for (const cmd of ((on.body as any)?.commands ?? [])) await finishCmd(admin, cmd.id, `cmd.get.group.on.${cmd.id.slice(-4)}`);
      const onA = await haState(ha, a.primary.entityId, (s) => s.state === "on");
      const onB = await haState(ha, b.primary.entityId, (s) => s.state === "on");
      ctx.add("both lights are on again", onA.state === "on" && onB.state === "on", "on/on", `${onA.state}/${onB.state}`);

      await admin.call("cmd.group.delete", "DELETE", `/api/v1/groups/${groupId}`);
    },
  },
];
