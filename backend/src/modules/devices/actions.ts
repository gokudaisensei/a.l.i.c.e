import { AppError } from "../../core/errors/errors";
import type { ActionSpec } from "../../core/database/schema";
import type { Role } from "../../core/database/schema";
import { resolveOperation, supportsOperation } from "../home-assistant";
import type { ThingsService } from "../home-assistant/things/things.service";
import { evaluateDeviceAccess } from "../permissions/device-access";
import type { PermissionService } from "../permissions/permission.service";
import type { CommandExecutor } from "./commands/command-executor";
import type { DeviceCommand } from "./commands/command-types";
import { validateParameters } from "./commands/expectations";
import type { Caller } from "./devices.service";

export interface SkippedAction {
  action: ActionSpec;
  reason: string;
}

/**
 * Checks and runs device actions on behalf of a person. Scenes, groups and routines are all built from this,
 * so they get the same rules as a single command: nothing runs that the person could not run themselves.
 */
export class ActionService {
  constructor(private readonly things: ThingsService, private readonly permissions: PermissionService, private readonly executor: CommandExecutor) {}

  private canSee(c: { householdId: string; userId: string; role: Role }, connectionId: string, entityId: string) {
    const policies = this.permissions.listPolicies(c.householdId).filter((p) => p.entityId === entityId);
    return evaluateDeviceAccess({ role: c.role, userId: c.userId, connectionId, entityId, policies }).allowed;
  }

  /** Is this entity real and visible to the caller? */
  canSeeEntity(c: { householdId: string; userId: string; role: Role }, entityId: string): boolean {
    const found = this.things.findEntity(c.householdId, entityId);
    return !!found && this.canSee(c, found.conn.config.id, entityId);
  }

  /** Would this action need a fresh passkey under the household's current rules? */
  async isSensitive(householdId: string, a: ActionSpec): Promise<boolean> {
    const found = this.things.findEntity(householdId, a.entityId);
    if (!found) return false;
    return Boolean(await this.permissions.sensitivityPolicy().isSensitive({ householdId, domain: found.entity.domain, action: a.action, deviceClass: found.entity.deviceClass }));
  }

  /** For saving a scene or routine: the action must be real, visible to you, supported and well-formed. */
  async validate(c: Caller, a: ActionSpec): Promise<void> {
    const found = this.things.findEntity(c.householdId, a.entityId);
    if (!found || !this.canSee(c, found.conn.config.id, a.entityId)) throw new AppError(404, "unknown_entity", `No such device entity: ${a.entityId}`);
    const { entity } = found;
    if (!supportsOperation(entity.capabilities, a.action)) throw new AppError(400, "unsupported_operation", `${a.entityId} does not support "${a.action}"`);
    const bad = validateParameters(a.action, a.parameters ?? {});
    if (bad) throw new AppError(400, "invalid_parameters", bad);
    if (!resolveOperation(entity.domain, a.action, a.parameters ?? {})) throw new AppError(400, "unsupported_operation", `No Home Assistant service for "${a.action}" on ${entity.domain}`);
    const sensitive = await this.permissions.sensitivityPolicy().isSensitive({ householdId: c.householdId, domain: entity.domain, action: a.action, deviceClass: entity.deviceClass });
    if (sensitive && !c.steppedUp) throw new AppError(403, "step_up_required", `"${a.action}" on ${a.entityId} needs a fresh passkey confirmation`);
  }

  /**
   * Starts every action at once as the caller. Actions on devices that no longer exist or that the caller cannot see are
   * skipped without saying why in detail; everything else goes through the normal command pipeline (authorization,
   * step-up, confirmation), so refusals show up as failed commands.
   */
  run(c: Caller, actions: ActionSpec[]): { commands: DeviceCommand[]; skipped: SkippedAction[] } {
    const commands: DeviceCommand[] = [];
    const skipped: SkippedAction[] = [];
    for (const a of actions) {
      const found = this.things.findEntity(c.householdId, a.entityId);
      if (!found) { skipped.push({ action: a, reason: "That device no longer exists" }); continue; }
      if (!this.canSee(c, found.conn.config.id, a.entityId)) { skipped.push({ action: a, reason: "Not available to you" }); continue; }
      commands.push(this.executor.submit({
        householdId: c.householdId, entityId: a.entityId, action: a.action, parameters: a.parameters,
        actor: { userId: c.userId, source: "user", steppedUp: c.steppedUp },
      }));
    }
    return { commands, skipped };
  }

  /** Waits for submitted commands to finish. */
  async finish(commands: DeviceCommand[]): Promise<DeviceCommand[]> {
    return Promise.all(commands.map((cmd) => this.executor.done(cmd.id)));
  }

  /** Does the caller see at least one target of these actions? Guests only get scenes and groups that touch something of theirs. */
  touchesVisible(c: Caller, actions: ActionSpec[]): boolean {
    return actions.some((a) => {
      const f = this.things.findEntity(c.householdId, a.entityId);
      return !!f && this.canSee(c, f.conn.config.id, a.entityId);
    });
  }
}
