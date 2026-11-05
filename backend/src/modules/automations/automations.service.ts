import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { automationRuns, automations, routines, scenes, type SyncStatus } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus, Unsubscribe } from "@/core/events/event-bus";
import { newId } from "@/core/ids";
import { writeAudit } from "@/core/security/audit";
import { createHash } from "node:crypto";
import type { NotificationsService } from "../notifications/notifications.service";
import type { PresenceService } from "../households/presence.service";
import type { ActionService } from "../devices/actions";
import type { Caller } from "../devices/devices.service";
import { powerLimitOf, powerSensorOf } from "../devices/settings";
import { automationConfigId } from "../home-assistant/compile";
import type { ConfigJob, ConfigJobService } from "../home-assistant/config-jobs.service";
import type { AutomationConfig, DriftItem } from "../home-assistant/config-ops";
import { type HaScriptView, type HaSyncService, scriptView } from "../home-assistant/sync.service";
import type { ThingsService } from "../home-assistant/things/things.service";
import type { ModeMirror } from "../household-modes/mode-mirror";
import type { HouseholdService } from "../households/household.service";
import type { RoutinesService } from "../routines/routines.service";
import type { ScenesService } from "../scenes/scenes.service";
import { CompileError, compileAutomation, type CompileContext, describeAutomation, type Names } from "./compile";
import { type AutomationDefinition, parseDefinition } from "./definition";

export interface AutomationView {
  id: string;
  name: string;
  enabled: boolean;
  summary: string;
  definition: AutomationDefinition;
  /** The Home Assistant automation that runs this, so it keeps working when Alice is down. */
  haAutomation: HaScriptView;
  /** Actions in this automation that need a passkey under today's rules, e.g. "unlock Front door". Admins are told when it runs. */
  sensitiveActions: string[];
  lastTriggeredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Preview {
  summary: string;
  /** What would be sent to Home Assistant, or null if it cannot be expressed there yet. */
  haConfig: AutomationConfig | null;
  warnings: string[];
}

const reverseId = (configId: string) => `atm_${configId.slice("alice_auto_".length).toUpperCase()}`;

/**
 * Automations: "when this happens, if that is true, do these things". Alice stores and validates them, compiles them into
 * Home Assistant automations through the config-worker, and records when Home Assistant ran them.
 */
export class AutomationsService {
  private unsubs: Unsubscribe[] = [];

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus<AppEvent>,
    private readonly jobs: ConfigJobService,
    private readonly sync: HaSyncService,
    private readonly things: ThingsService,
    private readonly actions: ActionService,
    private readonly mirror: ModeMirror,
    private readonly households: HouseholdService,
    private readonly scenesSvc: ScenesService,
    private readonly routinesSvc: RoutinesService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly now: () => number = Date.now,
  ) {
    jobs.onResult("automation.upsert", (job) => this.applyUpsert(job));
    sync.onReconcile((householdId, userId) => {
      for (const r of this.db.select().from(automations).where(and(eq(automations.householdId, householdId), inArray(automations.syncStatus, ["not_synced", "failed", "drifted"]))).all()) this.syncRow(householdId, r, userId);
    });
    sync.provideVerification(
      (householdId) => ({
        automations: this.db.select().from(automations).where(and(eq(automations.householdId, householdId), inArray(automations.syncStatus, ["synced", "drifted"]))).all().flatMap((r) => {
          try { return [{ id: automationConfigId(r.id), config: compileAutomation(r.name, r.definition as unknown as AutomationDefinition, this.context(householdId)), enabled: r.enabled }]; } catch { return []; }
        }),
      }),
      (householdId, drifted, checked) => this.applyDrift(householdId, drifted, checked),
    );
  }

  start() {
    this.unsubs.push(
      this.bus.subscribe("ha.automation_triggered", (e) => this.recordRun(e.householdId, e.entityId, e.source)),
      // A new power limit changes the number baked into a power trigger.
      this.bus.subscribe("settings.changed", (e) => this.recompileForEntity(e.householdId, e.entityId)),
      // What an automation compiles to depends on who the household's people are and what Home Assistant has; re-check when that changes.
      this.bus.subscribe("presence.links_changed", (e) => this.recheck(e.householdId)),
      this.bus.subscribe("inventory.synced", (e) => this.recheck(e.householdId)),
    );
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u();
  }

  // ---- compile context and names ----

  private context(householdId: string): CompileContext {
    return {
      personEntityIds: this.presence.relevant(householdId).map((p) => p.entityId),
      personOfUser: (userId) => this.presence.personOf(householdId, userId),
      powerLimit: (entityId) => {
        const f = this.things.findEntity(householdId, entityId);
        if (!f?.thing) return null;
        const sensor = powerSensorOf(f.conn, f.thing);
        const limit = powerLimitOf(this.db, f.conn.config.id, [...(f.thing.primary ? [f.thing.primary.entityId] : []), entityId, ...(sensor ? [sensor] : [])]);
        return sensor && limit ? { sensor, limitW: limit } : null;
      },
    };
  }

  private names(householdId: string): Names {
    const ent = (id: string) => this.things.findEntity(householdId, id);
    return {
      device: (id) => ent(id)?.thing?.name ?? id,
      person: (id) => ent(id)?.entity.sourceName ?? id,
      user: (id) => this.households.listMembers(householdId).find((m) => m.userId === id)?.displayName ?? "someone",
      scene: (id) => this.db.select({ n: scenes.name }).from(scenes).where(eq(scenes.id, id)).get()?.n ?? "a scene",
      routine: (id) => this.db.select({ n: routines.name }).from(routines).where(eq(routines.id, id)).get()?.n ?? "a routine",
    };
  }

  // ---- checking what a person may save ----

  /** Everything the shape check cannot know: that devices exist and are yours, references are real, step-up for sensitive actions. */
  private async check(c: Caller, def: AutomationDefinition) {
    const ctx = this.context(c.householdId);
    const t = def.trigger;
    if (t.type === "arrive" && "userId" in t) {
      if (!this.households.listMembers(c.householdId).some((m) => m.userId === t.userId)) throw new AppError(404, "not_found", "That member is not in this household");
      if (!ctx.personOfUser(t.userId)) throw new AppError(409, "person_not_linked", "Link that member to a Home Assistant person first");
    } else if (t.type === "arrive" || t.type === "leave") {
      if (!ctx.personEntityIds.length) throw new AppError(409, "no_people", "No people are set up in Home Assistant yet");
      if (t.type === "arrive" && t.person !== "anyone" && !ctx.personEntityIds.includes(t.person)) throw new AppError(404, "unknown_entity", "That person is not in Home Assistant");
    }
    if (t.type === "door_opens" || t.type === "motion" || t.type === "power_over_limit") {
      const f = this.things.findEntity(c.householdId, t.entityId);
      if (!f || !this.actions.canSeeEntity(c, t.entityId)) throw new AppError(404, "unknown_entity", `No such device: ${t.entityId}`);
      if (t.type !== "power_over_limit" && f.entity.domain !== "binary_sensor") throw new AppError(400, "validation_error", `${t.entityId} is not a sensor that can open or detect motion`);
      if (t.type === "power_over_limit" && !ctx.powerLimit(t.entityId)) throw new AppError(409, "no_power_limit", "Set a power limit on that device first (it needs a power reading too)");
    }
    const usesMode = def.conditions.some((x) => x.type === "mode") || def.actions.some((a) => a.type === "mode");
    if (usesMode && this.mirror.status(c.householdId).status !== "active") throw new AppError(409, "mode_not_mirrored", "Home Assistant is not following the household mode yet, so it cannot use it");
    // Nobody can confirm with a passkey when Home Assistant runs this unattended, so doing something sensitive that way is an admin's call.
    if ((await this.sensitiveActionsOf(c.householdId, def)).length && c.role !== "admin") {
      throw new AppError(403, "forbidden", "Only an admin can save an automation that does something sensitive, like unlocking a door");
    }
    const members = new Set(this.households.listMembers(c.householdId).map((m) => m.userId));
    for (const a of def.actions) {
      if (a.type === "device") await this.actions.validate(c, a);
      else if (a.type === "scene") this.scenesSvc.get(c, a.sceneId);
      else if (a.type === "routine") this.routinesSvc.get(c, a.routineId);
      else if (a.type === "notify" && a.userIds?.some((u) => !members.has(u))) throw new AppError(400, "validation_error", "You can only notify people in this household");
    }
  }

  /** The device actions that need a passkey under the household's current rules, described for people. */
  private async sensitiveActionsOf(householdId: string, def: AutomationDefinition): Promise<string[]> {
    const out: string[] = [];
    const names = this.names(householdId);
    for (const a of def.actions) {
      if (a.type === "device" && (await this.actions.isSensitive(householdId, a))) out.push(`${a.action.replace(/_/g, " ")} ${names.device(a.entityId)}`);
    }
    return out;
  }

  private cleanName(name: string) {
    const n = name.trim();
    if (n.length < 1 || n.length > 80) throw new AppError(400, "validation_error", "Name must be 1 to 80 characters");
    return n;
  }

  /** Shows what a definition means and what Home Assistant would receive, without saving anything. */
  async preview(c: Caller, name: string, input: unknown): Promise<Preview> {
    const def = parseDefinition(input);
    await this.check(c, def);
    const warnings: string[] = [];
    let haConfig: AutomationConfig | null = null;
    try { haConfig = compileAutomation(this.cleanName(name), def, this.context(c.householdId)); } catch (e) { if (e instanceof CompileError) warnings.push(e.message); else throw e; }
    const ready = this.sync.ready(c.householdId);
    if (!ready.ok) warnings.push(ready.reason);
    return { summary: describeAutomation(def, this.names(c.householdId)), haConfig, warnings };
  }

  // ---- views ----

  private async view(householdId: string, r: typeof automations.$inferSelect): Promise<AutomationView> {
    const def = r.definition as unknown as AutomationDefinition;
    return {
      id: r.id, name: r.name, enabled: r.enabled, summary: describeAutomation(def, this.names(householdId)), definition: def, haAutomation: scriptView(r), sensitiveActions: await this.sensitiveActionsOf(householdId, def),
      lastTriggeredAt: r.lastTriggeredAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  private row(c: Caller, id: string) {
    const r = this.db.select().from(automations).where(eq(automations.id, id)).get();
    if (!r || r.householdId !== c.householdId) throw notFound("Automation");
    return r;
  }

  async list(c: Caller): Promise<AutomationView[]> {
    return Promise.all(this.db.select().from(automations).where(eq(automations.householdId, c.householdId)).orderBy(asc(automations.name)).all().map((r) => this.view(c.householdId, r)));
  }

  async get(c: Caller, id: string): Promise<AutomationView> {
    return this.view(c.householdId, this.row(c, id));
  }

  // ---- changes ----

  async create(c: Caller, body: { name: string; enabled?: boolean; definition: unknown }): Promise<AutomationView> {
    const name = this.cleanName(body.name);
    const def = parseDefinition(body.definition);
    await this.check(c, def);
    const t = this.now();
    const id = newId("atm");
    this.db.insert(automations).values({ id, householdId: c.householdId, name, definition: def as unknown as Record<string, unknown>, enabled: body.enabled ?? true, createdBy: c.userId, createdAt: t, updatedAt: t }).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "automations.created", resource: id }, t);
    this.syncRow(c.householdId, this.rawRow(id), c.userId);
    return this.get(c, id);
  }

  async update(c: Caller, id: string, body: { name?: string; enabled?: boolean; definition?: unknown }): Promise<AutomationView> {
    const r = this.row(c, id);
    const patch: Partial<typeof automations.$inferInsert> = { updatedAt: this.now() };
    if (body.name !== undefined) patch.name = this.cleanName(body.name);
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.definition !== undefined) {
      const def = parseDefinition(body.definition);
      await this.check(c, def);
      patch.definition = def as unknown as Record<string, unknown>;
    }
    this.db.update(automations).set(patch).where(eq(automations.id, r.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "automations.updated", resource: id, detail: { enabled: body.enabled } }, this.now());
    this.syncRow(c.householdId, this.rawRow(id), c.userId);
    return this.get(c, id);
  }

  setEnabled(c: Caller, id: string, enabled: boolean) {
    return this.update(c, id, { enabled });
  }

  remove(c: Caller, id: string) {
    const r = this.row(c, id);
    this.db.delete(automations).where(eq(automations.id, r.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "automations.deleted", resource: id }, this.now());
    if (this.sync.ready(c.householdId).ok) this.jobs.enqueue(c.householdId, { op: "automation.delete", id: automationConfigId(id) }, { dedupeKey: `automation:${automationConfigId(id)}` });
  }

  private rawRow(id: string) {
    return this.db.select().from(automations).where(eq(automations.id, id)).get()!;
  }

  private mark(id: string, patch: { syncStatus: SyncStatus; syncError?: string | null; syncedAt?: number | null; haEntityId?: string | null }) {
    this.db.update(automations).set(patch).where(eq(automations.id, id)).run();
  }

  /** Queues the automation for Home Assistant (after any scene or routine scripts it calls). */
  private syncRow(householdId: string, r: typeof automations.$inferSelect, userId: string | null) {
    const ready = this.sync.ready(householdId);
    if (!ready.ok) return this.mark(r.id, { syncStatus: "not_synced", syncError: ready.reason });
    const def = r.definition as unknown as AutomationDefinition;
    for (const a of def.actions) {
      if (a.type === "scene") { const s = this.db.select().from(scenes).where(eq(scenes.id, a.sceneId)).get(); if (s && s.syncStatus !== "synced" && s.syncStatus !== "pending") this.sync.syncScene(householdId, s, userId); }
      if (a.type === "routine") { const x = this.db.select().from(routines).where(eq(routines.id, a.routineId)).get(); if (x && x.syncStatus !== "synced" && x.syncStatus !== "pending") this.sync.syncRoutine(householdId, x, userId); }
    }
    try {
      const config = compileAutomation(r.name, def, this.context(householdId));
      const id = automationConfigId(r.id);
      this.jobs.enqueue(householdId, { op: "automation.upsert", id, config, enabled: r.enabled }, { requestedBy: userId, dedupeKey: `automation:${id}` });
      this.db.update(automations).set({ compiledHash: this.hash(config, r.enabled) }).where(eq(automations.id, r.id)).run();
      this.mark(r.id, { syncStatus: "pending", syncError: null });
    } catch (e) {
      this.mark(r.id, { syncStatus: "failed", syncError: e instanceof CompileError ? e.message : e instanceof Error ? e.message : String(e) });
    }
  }

  private applyUpsert(job: ConfigJob) {
    const id = reverseId(String(job.payload.id ?? ""));
    if (!this.db.select({ id: automations.id }).from(automations).where(eq(automations.id, id)).get()) return;
    if (job.status === "done") this.mark(id, { syncStatus: "synced", syncError: null, syncedAt: this.now(), haEntityId: (job.result?.entityId as string | null) ?? null });
    else this.mark(id, { syncStatus: "failed", syncError: job.error ?? "Home Assistant did not accept it" });
  }

  private hash(config: AutomationConfig, enabled: boolean) {
    return createHash("sha256").update(JSON.stringify({ config, enabled })).digest("hex").slice(0, 32);
  }

  /**
   * Compiles every automation again and sends the ones whose Home Assistant config would now be different: a new person
   * for "someone gets home", a changed link between a member and a person, a changed power limit.
   */
  recheck(householdId: string) {
    if (!this.sync.ready(householdId).ok) return;
    for (const r of this.db.select().from(automations).where(eq(automations.householdId, householdId)).all()) {
      const def = r.definition as unknown as AutomationDefinition;
      let h: string | null = null;
      try { h = this.hash(compileAutomation(r.name, def, this.context(householdId)), r.enabled); } catch { /* it no longer compiles: syncRow records why */ }
      if (h !== r.compiledHash) this.syncRow(householdId, r, null);
    }
  }

  private applyDrift(householdId: string, drifted: DriftItem[], checked: string[]) {
    const newly: string[] = [];
    const text = { missing: "It was removed from Home Assistant", changed: "It was changed in Home Assistant", enabled_changed: "It was switched on or off in Home Assistant" } as const;
    for (const configId of checked) {
      const id = reverseId(configId);
      const r = this.db.select().from(automations).where(eq(automations.id, id)).get();
      if (!r) continue;
      const d = drifted.find((x) => x.kind === "automation" && x.id === configId);
      if (d) {
        if (r.syncStatus !== "drifted") newly.push(r.name);
        this.mark(id, { syncStatus: "drifted", syncError: text[d.reason] });
      } else if (r.syncStatus === "drifted") this.mark(id, { syncStatus: "synced", syncError: null });
    }
    if (newly.length) this.drift?.(householdId, newly);
  }

  /** Set by the app to tell admins when an automation was changed behind Alice's back. */
  drift: ((householdId: string, names: string[]) => void) | null = null;

  private recompileForEntity(householdId: string, entityId: string) {
    const f = this.things.findEntity(householdId, entityId);
    if (!f?.thing) return;
    const ids = new Set(f.thing.entityIds);
    for (const r of this.db.select().from(automations).where(eq(automations.householdId, householdId)).all()) {
      const t = (r.definition as unknown as AutomationDefinition).trigger;
      if (t.type === "power_over_limit" && ids.has(t.entityId)) this.syncRow(householdId, r, null);
    }
  }

  // ---- runs ----

  private recordRun(householdId: string, haEntityId: string, source: string | null) {
    const r = this.db.select().from(automations).where(and(eq(automations.householdId, householdId), eq(automations.haEntityId, haEntityId))).get();
    if (!r) return; // not one of Alice's
    const t = this.now();
    this.db.insert(automationRuns).values({ id: newId("arn"), automationId: r.id, householdId, triggeredAt: t, source }).run();
    this.db.update(automations).set({ lastTriggeredAt: t }).where(eq(automations.id, r.id)).run();
    // Something sensitive happened with nobody confirming it: tell the admins, even in quiet hours.
    const def = r.definition as unknown as AutomationDefinition;
    void this.sensitiveActionsOf(householdId, def).then((sensitive) => {
      if (sensitive.length) this.notifications.notifyAdmins(householdId, { kind: "sensitive_automation", title: `“${r.name}” ran`, body: `It ran automatically and did this: ${sensitive.join(", ")}.`, data: { automationId: r.id }, urgent: true });
    }).catch(() => {});
  }

  runs(c: Caller, id: string, limit = 50) {
    const r = this.row(c, id);
    return this.db.select().from(automationRuns).where(eq(automationRuns.automationId, r.id)).orderBy(desc(automationRuns.triggeredAt), desc(automationRuns.id)).limit(Math.min(limit, 200)).all()
      .map((x) => ({ id: x.id, triggeredAt: x.triggeredAt, source: x.source }));
  }
}
