import { asc, eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { type ActionSpec, scenes } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { writeAudit } from "@/core/security/audit";
import type { ActionService, SkippedAction } from "../devices/actions";
import type { DeviceCommand } from "../devices/commands/command-types";
import type { Caller } from "../devices/devices.service";
import { type HaScriptView, type HaSyncService, scriptView } from "../home-assistant/sync.service";

export const MAX_SCENE_ACTIONS = 50;

export interface SceneView {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  lastRunAt: number | null;
  /** Hidden from guests, who only learn that the scene exists. */
  actions?: ActionSpec[];
  /** The Home Assistant script that mirrors this scene (so it also runs from HA). Hidden from guests. */
  haScript?: HaScriptView;
}

/**
 * A scene is a saved set of device changes. Activating it starts them all at once, as the person who activated it:
 * they can only change what they could change by hand, and sensitive operations still need their passkey.
 */
export class ScenesService {
  constructor(private readonly db: Db, private readonly actions: ActionService, private readonly now: () => number = Date.now, private readonly sync?: HaSyncService) {}

  private row(c: Caller, id: string) {
    const s = this.db.select().from(scenes).where(eq(scenes.id, id)).get();
    if (!s || s.householdId !== c.householdId) throw notFound("Scene");
    if (c.role === "guest" && !this.actions.touchesVisible(c, s.actions)) throw notFound("Scene"); // nothing in it is theirs
    return s;
  }

  private view(c: Caller, s: typeof scenes.$inferSelect): SceneView {
    return { id: s.id, name: s.name, icon: s.icon, description: s.description, lastRunAt: s.lastRunAt, ...(c.role === "guest" ? {} : { actions: s.actions, haScript: scriptView(s) }) };
  }

  list(c: Caller): SceneView[] {
    return this.db.select().from(scenes).where(eq(scenes.householdId, c.householdId)).orderBy(asc(scenes.name)).all()
      .filter((s) => c.role !== "guest" || this.actions.touchesVisible(c, s.actions))
      .map((s) => this.view(c, s));
  }

  get(c: Caller, id: string) {
    return this.view(c, this.row(c, id));
  }

  private async clean(c: Caller, body: { name?: string; actions?: ActionSpec[] }) {
    const out: { name?: string; actions?: ActionSpec[] } = {};
    if (body.name !== undefined) {
      const n = body.name.trim();
      if (n.length < 1 || n.length > 60) throw new AppError(400, "validation_error", "Name must be 1 to 60 characters");
      out.name = n;
    }
    if (body.actions) {
      if (!body.actions.length) throw new AppError(400, "validation_error", "A scene needs at least one action");
      if (body.actions.length > MAX_SCENE_ACTIONS) throw new AppError(400, "validation_error", `At most ${MAX_SCENE_ACTIONS} actions per scene`);
      for (const a of body.actions) await this.actions.validate(c, a);
      out.actions = body.actions.map((a) => ({ entityId: a.entityId, action: a.action, ...(a.parameters ? { parameters: a.parameters } : {}) }));
    }
    return out;
  }

  async create(c: Caller, body: { name: string; icon?: string | null; description?: string | null; actions: ActionSpec[] }) {
    const clean = await this.clean(c, body);
    const t = this.now();
    const id = newId("scn");
    this.db.insert(scenes).values({ id, householdId: c.householdId, name: clean.name!, icon: body.icon ?? null, description: body.description ?? null, actions: clean.actions!, createdBy: c.userId, createdAt: t, updatedAt: t }).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "scenes.created", resource: id }, t);
    this.sync?.syncScene(c.householdId, this.db.select().from(scenes).where(eq(scenes.id, id)).get()!, c.userId);
    return this.get(c, id);
  }

  async update(c: Caller, id: string, body: { name?: string; icon?: string | null; description?: string | null; actions?: ActionSpec[] }) {
    const s = this.row(c, id);
    const clean = await this.clean(c, body);
    const patch = { ...clean, ...(body.icon !== undefined ? { icon: body.icon } : {}), ...(body.description !== undefined ? { description: body.description } : {}), updatedAt: this.now() };
    this.db.update(scenes).set(patch).where(eq(scenes.id, s.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "scenes.updated", resource: id }, this.now());
    this.sync?.syncScene(c.householdId, this.db.select().from(scenes).where(eq(scenes.id, id)).get()!, c.userId);
    return this.get(c, id);
  }

  remove(c: Caller, id: string) {
    const s = this.row(c, id);
    this.db.delete(scenes).where(eq(scenes.id, s.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "scenes.deleted", resource: id }, this.now());
    this.sync?.removeScene(c.householdId, id);
  }

  /** Starts every action. Returns at once; the commands report their own progress. */
  activate(c: Caller, id: string): { commands: DeviceCommand[]; skipped: SkippedAction[] } {
    const s = this.row(c, id);
    const r = this.actions.run(c, s.actions);
    this.db.update(scenes).set({ lastRunAt: this.now() }).where(eq(scenes.id, s.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "scenes.activated", resource: id, detail: { started: r.commands.length, skipped: r.skipped.length } }, this.now());
    return r;
  }
}
