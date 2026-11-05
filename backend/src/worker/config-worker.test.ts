import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { configJobs, haConnections } from "@/core/database/schema";
import { generateSealKeyPair } from "@/core/security/sealed";
import { ConfigWorker } from "./config-worker";
import { ConfigOpError, MODE_HELPER_ENTITY, TEMPLATE_NO_ONE_HOME, validateOperation, type ConfigOperation } from "@/modules/home-assistant/config-ops";
import { httpError } from "@/testing/fake-config-api";
import { ADMIN_TOKEN, createWorld, homeWithHa, SEAL_KEYS, SECRETS_KEY, type World } from "@/testing/world";
import { households } from "@/core/database/schema";
import pino from "pino";

const script = (over: object = {}): ConfigOperation => ({ op: "script.upsert", objectId: "alice_scene_1", config: { alias: "Alice: Movie", mode: "single", sequence: [{ service: "light.turn_on", target: { entity_id: "light.floor_lamp" }, data: { brightness_pct: 15 } }] }, ...over }) as ConfigOperation;
const rejects = (o: unknown, msg?: RegExp) => expect(() => validateOperation(o as ConfigOperation)).toThrow(msg ?? ConfigOpError);

describe("what the worker will and will not do", () => {
  test("accepts well-formed scripts, automations, helpers and voice changes", () => {
    for (const o of [
      script(),
      script({ config: { alias: "x", mode: "parallel", sequence: [{ parallel: [{ service: "lock.lock", target: { entity_id: "lock.front" } }, { service: "switch.turn_off", target: { entity_id: "switch.a" } }] }, { delay: { seconds: 30 } }] } }),
      { op: "automation.upsert", id: "alice_auto_1", enabled: true, config: { alias: "A", mode: "single", trigger: [{ platform: "state", entity_id: ["person.a", "person.b"], to: "home" }, { platform: "time", at: "22:30:00" }, { platform: "sun", event: "sunset", offset: "-00:30:00" }, { platform: "numeric_state", entity_id: "sensor.power", above: 1350 }], condition: [{ condition: "template", value_template: TEMPLATE_NO_ONE_HOME }, { condition: "time", weekday: ["mon", "tue"] }, { condition: "state", entity_id: MODE_HELPER_ENTITY, state: "night" }], action: [{ service: "script.alice_scene_1" }, { service: "input_select.select_option", target: { entity_id: MODE_HELPER_ENTITY }, data: { option: "away" } }, { event: "alice_notification", event_data: { message: "hi" } }] } },
      { op: "helper.ensure_mode_select", options: ["home", "away", "night", "vacation"] },
      { op: "voice.expose", entityIds: ["light.floor_lamp"], expose: true },
      { op: "script.delete", objectId: "alice_scene_1" }, { op: "automation.delete", id: "alice_auto_1" }, { op: "automation.set_enabled", id: "alice_auto_1", enabled: false },
    ] as ConfigOperation[]) expect(() => validateOperation(o)).not.toThrow();
  });

  test("refuses anything that is not Alice's own", () => {
    rejects(script({ objectId: "my_other_script" }), /alice_/);
    rejects({ op: "script.delete", objectId: "automation_everything" });
    rejects({ op: "automation.set_enabled", id: "someone_elses", enabled: false });
    rejects({ op: "automation.upsert", id: "front_door_unlock", enabled: true, config: { alias: "x", mode: "single", trigger: [{ platform: "time", at: "10:00" }], condition: [], action: [{ service: "light.turn_on" }] } });
  });

  test("refuses services, triggers, conditions, templates and events outside the fixed set", () => {
    const seq = (a: object) => script({ config: { alias: "x", mode: "single", sequence: [a] } });
    rejects(seq({ service: "shell_command.run" }), /not allowed/);
    rejects(seq({ service: "homeassistant.restart" }), /not allowed/);
    rejects(seq({ service: "light.turn_on", target: { entity_id: "not an entity" } }));
    rejects(seq({ service: "script.turn_on", target: { entity_id: "script.some_other_script" } }), /Alice scripts/);
    rejects(seq({ service: "input_select.select_option", target: { entity_id: "input_select.other" } }), /mode helper/);
    rejects(seq({ event: "call_service" }), /alice_notification/);
    rejects(seq({ delay: { seconds: 99999 } }), /Delay/);
    rejects(seq({ nonsense: true }));
    rejects(seq({ parallel: [{ parallel: [{ parallel: [{ parallel: [{ parallel: [{ delay: { seconds: 1 } }] }] }] }] }] }));
    const auto = (over: object) => ({ op: "automation.upsert", id: "alice_a", enabled: true, config: { alias: "x", mode: "single", trigger: [{ platform: "time", at: "10:00" }], condition: [], action: [{ service: "light.turn_on", target: { entity_id: "light.a" } }], ...over } }) as ConfigOperation;
    rejects(auto({ trigger: [{ platform: "webhook", webhook_id: "x" }] }), /not allowed/);
    rejects(auto({ trigger: [{ platform: "event", event_type: "x" }] }));
    rejects(auto({ condition: [{ condition: "template", value_template: "{{ 1 + 1 }}" }] }), /template/);
    rejects(auto({ condition: [{ condition: "time", weekday: ["someday"] }] }));
    rejects(auto({ trigger: [] }));
    rejects(auto({ action: [] }));
    rejects({ op: "voice.expose", entityIds: [], expose: true });
    rejects({ op: "voice.expose", entityIds: ["bad id"], expose: true });
    rejects({ op: "helper.ensure_mode_select", options: ["Home"] });
    rejects({ op: "run.anything", cmd: "rm -rf /" } as never, /Unknown operation/);
  });
});

describe("the worker", () => {
  let w: World;
  let h: Awaited<ReturnType<typeof homeWithHa>>;
  const householdId = () => w.db.select().from(haConnections).get()!.householdId;
  /** Stores the admin token, then lets the worker finish the mode-helper job that storing it queues, so tests start from a clean slate. */
  const adminToken = async () => {
    await h.withAdminToken();
    await w.worker.drain();
    w.services.configJobs.applyResults();
    w.configApi.calls.length = 0;
    w.configApi.reloads.length = 0;
    w.configApi.modeHelperOptions = null;
    w.configApi.closed = 0;
  };
  const queue = (op: ConfigOperation, key?: string) => w.services.configJobs.enqueue(householdId(), op, { dedupeKey: key })!;

  beforeEach(async () => {
    w = createWorld();
    h = await homeWithHa(w);
  });

  test("a stored admin token is sealed: the server can store it but cannot read it, and without the public key it refuses to store one", async () => {
    expect((await h.withAdminToken()).status).toBe(200);
    const stored = w.db.select().from(haConnections).get()!.adminTokenEnc!;
    expect(stored.startsWith("s1.")).toBe(true);
    expect(stored).not.toContain(ADMIN_TOKEN);
    const { open } = await import("@/core/security/sealed");
    expect(open(stored, SEAL_KEYS.privateKey)).toBe(ADMIN_TOKEN);
    expect(() => open(stored, SEAL_KEYS.publicKey)).toThrow();
    const { createServices } = await import("@/services");
    const noKey = createServices(w.db, { secretsKey: SECRETS_KEY, adminSealPublicKey: null, gatewayFactory: () => w.gw });
    await expect(noKey.ha.setAdminToken(householdId(), "u", ADMIN_TOKEN)).rejects.toMatchObject({ code: "not_configured" });
  });

  test("runs a job, records the result, and closes its connection each time", async () => {
    await adminToken();
    const id = queue(script());
    expect(await w.worker.drain()).toBe(1);
    const job = w.services.configJobs.get(id)!;
    expect(job).toMatchObject({ status: "done", result: { entityId: "script.alice_scene_1" } });
    expect(w.configApi.scripts.get("alice_scene_1")!.alias).toBe("Alice: Movie");
    expect(w.configApi.reloads).toEqual(["script"]);
    expect(w.configApi.closed).toBe(1);
  });

  test("automations are written, reloaded, looked up and switched on or off", async () => {
    await adminToken();
    const base = { alias: "A", mode: "single" as const, trigger: [{ platform: "time" as const, at: "10:00:00" }], condition: [], action: [{ service: "light.turn_on", target: { entity_id: "light.a" } }] };
    const id = queue({ op: "automation.upsert", id: "alice_auto_1", enabled: false, config: base });
    await w.worker.drain();
    expect(w.services.configJobs.get(id)!.result).toEqual({ entityId: "automation.alice_auto_1" });
    expect(w.configApi.enabled.get("automation.alice_auto_1")).toBe(false);
    queue({ op: "automation.set_enabled", id: "alice_auto_1", enabled: true });
    await w.worker.drain();
    expect(w.configApi.enabled.get("automation.alice_auto_1")).toBe(true);
    queue({ op: "automation.delete", id: "alice_auto_1" });
    await w.worker.drain();
    expect(w.configApi.automations.size).toBe(0);
  });

  test("helper and voice jobs reach the right calls", async () => {
    await adminToken();
    queue({ op: "helper.ensure_mode_select", options: ["home", "away", "night", "vacation"] });
    queue({ op: "voice.expose", entityIds: ["light.floor_lamp", "switch.kettle_plug"], expose: true });
    await w.worker.drain();
    expect(w.configApi.modeHelperOptions).toEqual(["home", "away", "night", "vacation"]);
    expect([...w.configApi.exposed]).toEqual([["light.floor_lamp", true], ["switch.kettle_plug", true]]);
  });

  test("no admin token, an unreadable token, or a missing connection fails the job with a clear reason and never calls Home Assistant", async () => {
    const a = queue(script());
    await w.worker.drain();
    expect(w.services.configJobs.get(a)).toMatchObject({ status: "failed", error: "No admin token has been stored for this Home Assistant" });
    await adminToken();
    const other = new ConfigWorker({ db: w.db, privateKeyPem: generateSealKeyPair().privateKey, apiFactory: () => w.configApi, log: pino({ level: "silent" }) });
    const b = queue(script());
    await other.drain();
    expect(w.services.configJobs.get(b)).toMatchObject({ status: "failed", error: "The stored admin token cannot be read by this worker" });
    expect(w.configApi.calls).toEqual([]);
  });

  test("a job whose payload was tampered with in the database is refused before anything happens", async () => {
    await adminToken();
    const id = queue(script());
    w.db.update(configJobs).set({ payload: { objectId: "alice_x", config: { alias: "x", mode: "single", sequence: [{ service: "shell_command.run" }] } } }).where(eq(configJobs.id, id)).run();
    await w.worker.drain();
    expect(w.services.configJobs.get(id)).toMatchObject({ status: "failed", error: "Service shell_command.run is not allowed" });
    expect(w.configApi.calls).toEqual([]);
  });

  test("transient errors are retried and then give up; permanent ones fail at once", async () => {
    await adminToken();
    w.configApi.failWith = new Error("connection refused");
    const id = queue(script());
    expect(await w.worker.drain()).toBe(3); // three attempts
    expect(w.services.configJobs.get(id)).toMatchObject({ status: "failed", error: "connection refused" });
    expect(w.db.select().from(configJobs).where(eq(configJobs.id, id)).get()!.attempts).toBe(3);
    w.configApi.failWith = httpError(403);
    const id2 = queue(script({ objectId: "alice_scene_2" }));
    expect(await w.worker.drain()).toBe(1);
    expect(w.services.configJobs.get(id2)!.status).toBe("failed");
    w.configApi.failWith = null;
    const id3 = queue(script({ objectId: "alice_scene_3" }));
    await w.worker.drain();
    expect(w.services.configJobs.get(id3)!.status).toBe("done");
  });

  test("a newer job for the same thing replaces one still waiting; others are untouched", async () => {
    await adminToken();
    const first = queue(script(), "script:alice_scene_1");
    const other = queue(script({ objectId: "alice_scene_2" }), "script:alice_scene_2");
    const second = queue(script({ config: { alias: "v2", mode: "single", sequence: [{ delay: { seconds: 1 } }] } }), "script:alice_scene_1");
    expect(w.services.configJobs.get(first)).toBeNull();
    await w.worker.drain();
    expect(w.services.configJobs.get(second)!.status).toBe("done");
    expect(w.services.configJobs.get(other)!.status).toBe("done");
    expect(w.configApi.scripts.get("alice_scene_1")!.alias).toBe("v2");
  });

  test("status shows whether changes can be applied; the server applies finished results exactly once", async () => {
    let st = w.services.configJobs.status(householdId());
    expect(st).toMatchObject({ connected: true, adminTokenSet: false, workerOnline: false });
    await adminToken();
    const id = queue(script());
    st = w.services.configJobs.status(householdId());
    expect(st).toMatchObject({ adminTokenSet: true, pendingJobs: 1 });
    await w.worker.drain();
    expect(w.services.configJobs.status(householdId())).toMatchObject({ workerOnline: true, pendingJobs: 0 });
    const seen: string[] = [];
    w.services.configJobs.onResult("script.", (j) => seen.push(j.id));
    expect(w.services.configJobs.applyResults()).toBe(1);
    expect(w.services.configJobs.applyResults()).toBe(0);
    expect(seen).toEqual([id]);
    w.clock.now += 20_000;
    expect(w.services.configJobs.status(householdId()).workerOnline).toBe(false);
  });

  test("with no Home Assistant connection there is nothing to queue", async () => {
    const w2 = createWorld();
    await w2.browser().register("Solo");
    expect(w2.services.configJobs.enqueue(w2.db.select().from(households).get()!.id, script())).toBeNull();
  });
});
