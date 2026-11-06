import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { HOUSEHOLD_MODES, type RoutineStep, routineRuns, routines } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { writeAudit } from "@/core/security/audit";
import type { ActionService } from "../devices/actions";
import { toPublicCommand } from "../devices/commands/public-command";
import type { Caller } from "../devices/devices.service";
import type { ModesService } from "../household-modes/modes.service";
import type { HouseholdService } from "../households/household.service";
import { can } from "../permissions/permissions";
import { type HaScriptView, type HaSyncService, scriptView } from "../home-assistant/sync.service";
import type { ScenesService } from "../scenes/scenes.service";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus } from "@/core/events/event-bus";

export const MAX_STEPS = 50;
export const MAX_DELAY_S = 3600;
const STEP_UP_WINDOW_MS = 5 * 60_000;
const RUN_RETENTION_MS = 30 * 24 * 3_600_000;

export type StepState = "pending" | "running" | "ok" | "failed" | "skipped";
export type RunState = "running" | "completed" | "failed" | "stopped" | "cancelled";

export interface StepResult {
  index: number;
  type: RoutineStep["type"];
  state: StepState;
  detail?: string;
  commandIds?: string[];
  /** The step as it was when the run started. */
  def: RoutineStep;
}

export interface RoutineView {
  id: string;
  name: string;
  icon: string | null;
  steps: RoutineStep[];
  onFailure: "continue" | "stop";
  lastRunAt: number | null;
  /** The Home Assistant script that mirrors this routine, so it also runs from HA. */
  haScript: HaScriptView;
}

const toView = (r: typeof routines.$inferSelect): RoutineView => ({ id: r.id, name: r.name, icon: r.icon, steps: r.steps, onFailure: r.onFailure, lastRunAt: r.lastRunAt, haScript: scriptView(r) });

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  householdId: string;
  userId: string;
  state: RunState;
  startedAt: number;
  finishedAt: number | null;
  steps: StepResult[];
}

/** Handle to a run being driven in this process. The run itself is stored in the database. */
interface Live { cancelled: boolean; wake: (() => void) | null; promise: Promise<void> }

/**
 * A routine is an ordered list of steps (device change, scene, mode change, wait) run one after another as the person
 * who started it. Every run and step is saved as it goes, so progress is never lost and a restart can pick a run back up
 * (see `resumeInterrupted`).
 */
export class RoutinesService {
  private live = new Map<string, Live>();

  constructor(
    private readonly db: Db,
    private readonly actions: ActionService,
    private readonly scenes: ScenesService,
    private readonly modes: ModesService,
    private readonly households: HouseholdService,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number, wake: (fn: () => void) => void) => Promise<void> = (ms, wake) =>
      new Promise((resolve) => { const t = setTimeout(resolve, ms); wake(() => { clearTimeout(t); resolve(); }); }),
    private readonly sync?: HaSyncService,
    private readonly bus?: EventBus<AppEvent>,
  ) {}

  private row(c: Caller, id: string) {
    const r = this.db.select().from(routines).where(eq(routines.id, id)).get();
    if (!r || r.householdId !== c.householdId) throw notFound("Routine");
    return r;
  }

  list(c: Caller): RoutineView[] {
    return this.db.select().from(routines).where(eq(routines.householdId, c.householdId)).orderBy(asc(routines.name)).all().map(toView);
  }

  get(c: Caller, id: string): RoutineView {
    return toView(this.row(c, id));
  }

  private async cleanSteps(c: Caller, steps: RoutineStep[]): Promise<RoutineStep[]> {
    if (!steps.length) throw new AppError(400, "validation_error", "A routine needs at least one step");
    if (steps.length > MAX_STEPS) throw new AppError(400, "validation_error", `At most ${MAX_STEPS} steps per routine`);
    const out: RoutineStep[] = [];
    for (const s of steps) {
      if (s.type === "device") {
        await this.actions.validate(c, s);
        out.push({ type: "device", entityId: s.entityId, action: s.action, ...(s.parameters ? { parameters: s.parameters } : {}) });
      } else if (s.type === "scene") {
        this.scenes.get(c, s.sceneId); // 404 if it does not exist or is not theirs
        out.push({ type: "scene", sceneId: s.sceneId });
      } else if (s.type === "mode") {
        if (!(HOUSEHOLD_MODES as readonly string[]).includes(s.mode)) throw new AppError(400, "validation_error", "Unknown mode");
        out.push({ type: "mode", mode: s.mode });
      } else if (s.type === "delay") {
        if (!Number.isFinite(s.seconds) || s.seconds < 1 || s.seconds > MAX_DELAY_S) throw new AppError(400, "validation_error", `A wait must be 1 to ${MAX_DELAY_S} seconds`);
        out.push({ type: "delay", seconds: Math.round(s.seconds) });
      } else throw new AppError(400, "validation_error", "Unknown step type");
    }
    return out;
  }

  private cleanName(name: string) {
    const n = name.trim();
    if (n.length < 1 || n.length > 60) throw new AppError(400, "validation_error", "Name must be 1 to 60 characters");
    return n;
  }

  async create(c: Caller, body: { name: string; icon?: string | null; steps: RoutineStep[]; onFailure?: "continue" | "stop" }) {
    const name = this.cleanName(body.name);
    const steps = await this.cleanSteps(c, body.steps);
    const t = this.now();
    const id = newId("rtn");
    this.db.insert(routines).values({ id, householdId: c.householdId, name, icon: body.icon ?? null, steps, onFailure: body.onFailure ?? "continue", createdBy: c.userId, createdAt: t, updatedAt: t }).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "routines.created", resource: id }, t);
    this.sync?.syncRoutine(c.householdId, this.row(c, id), c.userId);
    return this.get(c, id);
  }

  async update(c: Caller, id: string, body: { name?: string; icon?: string | null; steps?: RoutineStep[]; onFailure?: "continue" | "stop" }) {
    const r = this.row(c, id);
    const patch: Partial<typeof routines.$inferInsert> = { updatedAt: this.now() };
    if (body.name !== undefined) patch.name = this.cleanName(body.name);
    if (body.icon !== undefined) patch.icon = body.icon;
    if (body.onFailure) patch.onFailure = body.onFailure;
    if (body.steps) patch.steps = await this.cleanSteps(c, body.steps);
    this.db.update(routines).set(patch).where(eq(routines.id, r.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "routines.updated", resource: id }, this.now());
    this.sync?.syncRoutine(c.householdId, this.row(c, id), c.userId);
    return this.get(c, id);
  }

  remove(c: Caller, id: string) {
    const r = this.row(c, id);
    this.db.delete(routines).where(eq(routines.id, r.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "routines.deleted", resource: id }, this.now());
    this.sync?.removeRoutine(c.householdId, id);
  }

  // ---- running ----

  private save(run: RoutineRun, extra: Partial<typeof routineRuns.$inferInsert> = {}) {
    this.db.update(routineRuns).set({ state: run.state, finishedAt: run.finishedAt, steps: run.steps, ...extra }).where(eq(routineRuns.id, run.id)).run();
  }

  private toRun(r: typeof routineRuns.$inferSelect): RoutineRun {
    return { id: r.id, routineId: r.routineId, routineName: r.routineName, householdId: r.householdId, userId: r.userId, state: r.state, startedAt: r.startedAt, finishedAt: r.finishedAt, steps: r.steps as StepResult[] };
  }

  /** Starts a run and returns straight away. Follow it with `getRun`. */
  execute(c: Caller, id: string): RoutineRun {
    const r = this.row(c, id);
    const t = this.now();
    const run: RoutineRun = {
      id: newId("run"), routineId: r.id, routineName: r.name, householdId: c.householdId, userId: c.userId, state: "running", startedAt: t, finishedAt: null,
      steps: r.steps.map((def, index) => ({ index, type: def.type, state: "pending" as StepState, def })),
    };
    // A passkey confirmation only covers the first few minutes; a long wait must not stretch it.
    const stepUpUntil = c.steppedUp ? t + STEP_UP_WINDOW_MS : 0;
    this.db.insert(routineRuns).values({ id: run.id, routineId: r.id, routineName: r.name, householdId: c.householdId, userId: c.userId, state: "running", startedAt: t, steps: run.steps, onFailure: r.onFailure, stepUpUntil }).run();
    this.db.update(routines).set({ lastRunAt: t }).where(eq(routines.id, r.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "routines.executed", resource: r.id, detail: { runId: run.id } }, t);
    this.start(run, c, r.onFailure, 0, stepUpUntil, null);
    return structuredClone(run);
  }

  private start(run: RoutineRun, c: Caller, onFailure: "continue" | "stop", from: number, stepUpUntil: number, firstDelayMs: number | null) {
    const live: Live = { cancelled: false, wake: null, promise: Promise.resolve() };
    this.live.set(run.id, live);
    live.promise = this.drive(live, run, c, onFailure, from, stepUpUntil, firstDelayMs)
      .catch(() => {
        run.state = "failed";
        run.finishedAt = this.now();
        for (const s of run.steps) if (s.state === "running" || s.state === "pending") { s.state = "failed"; s.detail = "Unexpected error"; }
        this.save(run);
      })
      .finally(() => this.live.delete(run.id));
  }

  /** Resolves when the run has finished. For tests and callers that want to wait. */
  async finished(runId: string): Promise<RoutineRun> {
    await this.live.get(runId)?.promise;
    const r = this.db.select().from(routineRuns).where(eq(routineRuns.id, runId)).get();
    if (!r) throw notFound("Run");
    return this.toRun(r);
  }

  private async drive(live: Live, run: RoutineRun, c: Caller, onFailure: "continue" | "stop", from: number, stepUpUntil: number, firstDelayMs: number | null) {
    let anyFailed = run.steps.some((s) => s.state === "failed");

    for (let i = from; i < run.steps.length; i++) {
      const res = run.steps[i]!;
      const step = res.def;
      if (live.cancelled) { res.state = "skipped"; continue; }
      res.state = "running";
      this.save(run, { nextStep: i });
      const who: Caller = { ...c, steppedUp: this.now() < stepUpUntil };
      const m = this.households.getMembership(c.userId); // people can lose access while a routine waits
      if (!m || m.householdId !== c.householdId) { res.state = "failed"; res.detail = "You no longer have access"; anyFailed = true; this.save(run); if (onFailure === "stop") break; continue; }
      who.role = m.role;

      let ok = true;
      if (step.type === "delay") {
        const ms = i === from && firstDelayMs !== null ? firstDelayMs : step.seconds * 1000;
        this.save(run, { resumeAt: this.now() + ms }); // a restart can carry on waiting
        await this.sleep(ms, (fn) => { live.wake = fn; });
        live.wake = null;
        res.detail = live.cancelled ? "Cancelled" : `Waited ${step.seconds}s`;
        res.state = live.cancelled ? "skipped" : "ok";
        this.save(run, { resumeAt: null });
        continue;
      }
      if (step.type === "mode") {
        if (!can(who.role, "mode.change")) { ok = false; res.detail = "You cannot change the household mode"; }
        else this.modes.set(c.householdId, c.userId, step.mode);
      } else {
        const started = step.type === "device" ? this.actions.run(who, [step]) : this.sceneRun(who, step.sceneId);
        res.commandIds = started.commands.map((x) => x.id);
        this.save(run);
        const done = await this.actions.finish(started.commands);
        const bad = done.filter((x) => x.state !== "confirmed");
        const problems = [...started.skipped.map((s) => s.reason), ...bad.map((x) => `${x.entityId}: ${toPublicCommand(x, this.now()).failure?.message ?? x.state}`)];
        if (problems.length) { ok = false; res.detail = problems.join("; "); }
        if (!started.commands.length && !started.skipped.length) res.detail = "Nothing to do";
      }
      res.state = ok ? "ok" : "failed";
      this.save(run);
      if (!ok) { anyFailed = true; if (onFailure === "stop") break; }
    }

    const stopped = run.steps.some((s) => s.state === "pending");
    for (const s of run.steps) if (s.state === "pending") s.state = "skipped";
    run.state = live.cancelled ? "cancelled" : stopped ? "stopped" : anyFailed ? "failed" : "completed";
    run.finishedAt = this.now();
    this.save(run, { resumeAt: null });
    this.bus?.publish({ type: "routine.finished", householdId: run.householdId, userId: run.userId, routineId: run.routineId, routineName: run.routineName, state: run.state as "completed" | "failed" | "stopped" | "cancelled", timestamp: new Date(this.now()).toISOString() });
  }

  /**
   * Call once at startup. A run that was waiting in a delay carries on for the time that is left. A run that was in the
   * middle of a step cannot know whether that step happened, so the step is marked failed and the routine's own
   * failure setting decides whether the rest still runs. Runs whose owner lost access, or whose routine is gone, end as failed.
   */
  resumeInterrupted(): number {
    const stuck = this.db.select().from(routineRuns).where(eq(routineRuns.state, "running")).all();
    for (const r of stuck) {
      const run = this.toRun(r);
      const m = this.households.getMembership(r.userId);
      const fail = (why: string) => {
        for (const s of run.steps) if (s.state === "running" || s.state === "pending") { s.state = "failed"; s.detail = why; }
        run.state = "failed"; run.finishedAt = this.now(); this.save(run, { resumeAt: null });
      };
      if (!m || m.householdId !== r.householdId) { fail("You no longer have access"); continue; }
      const idx = run.steps.findIndex((s) => s.state === "running");
      let from = idx === -1 ? run.steps.findIndex((s) => s.state === "pending") : idx;
      if (from === -1) { run.state = "completed"; run.finishedAt = this.now(); this.save(run); continue; }
      let delayMs: number | null = null;
      if (idx !== -1) {
        const cur = run.steps[idx]!;
        if (cur.type === "delay" && r.resumeAt !== null) delayMs = Math.max(0, r.resumeAt - this.now());
        else {
          cur.state = "failed"; cur.detail = "Interrupted by a restart; it may or may not have happened";
          if (r.onFailure === "stop") { for (const s of run.steps) if (s.state === "pending") s.state = "skipped"; run.state = "stopped"; run.finishedAt = this.now(); this.save(run); continue; }
          from = idx + 1;
        }
      }
      const caller: Caller = { householdId: r.householdId, userId: r.userId, role: m.role, steppedUp: false };
      this.start(run, caller, r.onFailure, from, r.stepUpUntil, delayMs);
    }
    // Old history is not kept forever.
    this.db.delete(routineRuns).where(and(lt(routineRuns.startedAt, this.now() - RUN_RETENTION_MS), eq(routineRuns.state, "completed"))).run();
    return stuck.length;
  }

  private sceneRun(c: Caller, sceneId: string) {
    try { return this.scenes.activate(c, sceneId); } catch { return { commands: [], skipped: [{ action: { entityId: sceneId, action: "activate" }, reason: "That scene is no longer available" }] }; }
  }

  private runFor(c: Caller, runId: string) {
    const r = this.db.select().from(routineRuns).where(eq(routineRuns.id, runId)).get();
    if (!r || r.householdId !== c.householdId || (c.role !== "admin" && r.userId !== c.userId)) throw notFound("Run");
    return r;
  }

  getRun(c: Caller, runId: string): RoutineRun {
    return this.toRun(this.runFor(c, runId));
  }

  /** Recent runs: yours, or everyone's for admins. */
  listRuns(c: Caller, limit = 50): RoutineRun[] {
    const rows = this.db.select().from(routineRuns).where(eq(routineRuns.householdId, c.householdId)).orderBy(desc(routineRuns.startedAt)).limit(200).all();
    return rows.filter((r) => c.role === "admin" || r.userId === c.userId).slice(0, limit).map((r) => this.toRun(r));
  }

  cancel(c: Caller, runId: string): RoutineRun {
    const r = this.runFor(c, runId);
    if (r.state !== "running") throw new AppError(409, "conflict", `That run already ${r.state === "completed" ? "finished" : r.state}`);
    const live = this.live.get(runId);
    if (live) { live.cancelled = true; live.wake?.(); }
    this.db.update(routineRuns).set({ cancelRequested: true }).where(eq(routineRuns.id, runId)).run();
    return this.toRun(this.db.select().from(routineRuns).where(eq(routineRuns.id, runId)).get()!);
  }
}
