import { asc, eq } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { groupMembers, groups } from "@/core/database/schema";
import { AppError, notFound } from "@/core/errors/errors";
import { newId } from "@/core/ids";
import { writeAudit } from "@/core/security/audit";
import { supportsOperation } from "../home-assistant";
import type { ThingView } from "../home-assistant/things/presentation";
import type { ThingsService } from "../home-assistant/things/things.service";
import { refMatches } from "../favorites/favorites.service";
import type { ActionService, SkippedAction } from "../devices/actions";
import type { DeviceCommand } from "../devices/commands/command-types";
import type { Caller, DevicesService } from "../devices/devices.service";

export const MAX_GROUP_MEMBERS = 100;

export interface GroupView {
  id: string;
  name: string;
  icon: string | null;
  /** Devices in the group that you can see. */
  devices: { id: string; name: string; available: boolean }[];
}

/** Logical sets of devices ("all lights"). A group is just a list; acting on it fans out into ordinary commands. */
export class GroupsService {
  constructor(
    private readonly db: Db,
    private readonly things: ThingsService,
    private readonly devices: DevicesService,
    private readonly actions: ActionService,
    private readonly now: () => number = Date.now,
  ) {}

  private rows(householdId: string) {
    return this.db.select().from(groups).where(eq(groups.householdId, householdId)).orderBy(asc(groups.name)).all();
  }

  private memberRows(groupId: string) {
    return this.db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId)).orderBy(asc(groupMembers.position)).all();
  }

  /** The group's devices as this caller sees them. Devices they cannot see are simply absent. */
  private visibleMembers(c: Caller, groupId: string): ThingView[] {
    const out: ThingView[] = [];
    for (const m of this.memberRows(groupId)) {
      for (const ct of this.things.forHousehold(c.householdId)) {
        if (ct.conn.config.id !== m.connectionId) continue;
        const thing = ct.things.find((t) => refMatches(t, m.ref));
        if (!thing) continue;
        try { out.push(this.devices.get(c, thing.id)); } catch { /* not visible to this caller */ }
      }
    }
    return out;
  }

  private view(c: Caller, g: typeof groups.$inferSelect): GroupView {
    return { id: g.id, name: g.name, icon: g.icon, devices: this.visibleMembers(c, g.id).map((v) => ({ id: v.id, name: v.name, available: v.available })) };
  }

  /** Everyone sees their groups; guests only see groups that contain something they can see. */
  list(c: Caller): GroupView[] {
    return this.rows(c.householdId).map((g) => this.view(c, g)).filter((v) => c.role !== "guest" || v.devices.length > 0);
  }

  private require(c: Caller, id: string) {
    const g = this.db.select().from(groups).where(eq(groups.id, id)).get();
    if (!g || g.householdId !== c.householdId) throw notFound("Group");
    return g;
  }

  get(c: Caller, id: string): GroupView {
    const v = this.view(c, this.require(c, id));
    if (c.role === "guest" && v.devices.length === 0) throw notFound("Group");
    return v;
  }

  private memberRefs(c: Caller, thingIds: string[]) {
    const unique = [...new Set(thingIds)];
    if (unique.length > MAX_GROUP_MEMBERS) throw new AppError(400, "validation_error", `At most ${MAX_GROUP_MEMBERS} devices per group`);
    return unique.map((id) => {
      this.devices.get(c, id); // 404 if the creator cannot see it
      const f = this.things.find(c.householdId, id)!;
      return { connectionId: f.conn.config.id, ref: f.thing.ref };
    });
  }

  private cleanName(name: string) {
    const n = name.trim();
    if (n.length < 1 || n.length > 60) throw new AppError(400, "validation_error", "Name must be 1 to 60 characters");
    return n;
  }

  create(c: Caller, body: { name: string; icon?: string | null; thingIds: string[] }): GroupView {
    const name = this.cleanName(body.name);
    const refs = this.memberRefs(c, body.thingIds);
    const id = newId("grp");
    this.db.transaction((tx) => {
      tx.insert(groups).values({ id, householdId: c.householdId, name, icon: body.icon ?? null, createdBy: c.userId, createdAt: this.now() }).run();
      refs.forEach((r, position) => tx.insert(groupMembers).values({ groupId: id, ...r, position }).run());
    });
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "groups.created", resource: id }, this.now());
    return this.get(c, id);
  }

  update(c: Caller, id: string, body: { name?: string; icon?: string | null; thingIds?: string[] }): GroupView {
    const g = this.require(c, id);
    const refs = body.thingIds ? this.memberRefs(c, body.thingIds) : null;
    this.db.transaction((tx) => {
      const patch: Partial<typeof groups.$inferInsert> = {};
      if (body.name !== undefined) patch.name = this.cleanName(body.name);
      if (body.icon !== undefined) patch.icon = body.icon;
      if (Object.keys(patch).length) tx.update(groups).set(patch).where(eq(groups.id, g.id)).run();
      if (refs) {
        tx.delete(groupMembers).where(eq(groupMembers.groupId, g.id)).run();
        refs.forEach((r, position) => tx.insert(groupMembers).values({ groupId: g.id, ...r, position }).run());
      }
    });
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "groups.updated", resource: id }, this.now());
    return this.view(c, this.require(c, id));
  }

  remove(c: Caller, id: string) {
    const g = this.require(c, id);
    this.db.delete(groups).where(eq(groups.id, g.id)).run();
    writeAudit(this.db, { householdId: c.householdId, actorId: c.userId, action: "groups.deleted", resource: id }, this.now());
  }

  /**
   * Runs one operation on every device of the group that can do it, as the caller.
   * A device may have several entities (a speaker with a camera and a mute switch), so each device uses the first of its
   * visible entities that supports the operation: its main one, then its other main entities, then its controls.
   * With `target: "all"` every supporting entity of the device is used instead (e.g. two switches on one board).
   * Devices that cannot do it are listed as skipped; devices the caller may not control show up as failed commands.
   */
  command(c: Caller, id: string, body: { action: string; parameters?: Record<string, unknown>; target?: "first" | "all" }): { commands: DeviceCommand[]; skipped: SkippedAction[] } {
    this.require(c, id);
    const members = this.visibleMembers(c, id);
    if (!members.length) throw notFound("Group");
    const skipped: SkippedAction[] = [];
    const specs: { entityId: string; action: string; parameters?: Record<string, unknown> }[] = [];
    for (const m of members) {
      const candidates = [m.primary, ...m.others, ...m.controls].filter((e) => e !== null);
      const able = candidates.filter((e) => supportsOperation(e.capabilities, body.action));
      if (!able.length) {
        skipped.push({ action: { entityId: candidates[0]?.entityId ?? m.id, action: body.action, parameters: body.parameters }, reason: `${m.name} cannot do "${body.action}"` });
        continue;
      }
      for (const e of body.target === "all" ? able : able.slice(0, 1)) specs.push({ entityId: e.entityId, action: body.action, parameters: body.parameters });
    }
    if (!specs.length) throw new AppError(400, "unsupported_operation", `None of the devices in this group can do "${body.action}"`);
    const r = this.actions.run(c, specs);
    return { commands: r.commands, skipped: [...skipped, ...r.skipped] };
  }
}
