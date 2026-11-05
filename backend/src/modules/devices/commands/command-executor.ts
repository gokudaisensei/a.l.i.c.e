import type { Logger } from "pino";
import type { AppEvent, CommandEvent } from "@/core/events/app-events";
import type { EventBus } from "@/core/events/event-bus";
import { newId } from "@/core/ids";
import { type ConnectionManager, type ManagedConnection, resolveOperation, supportsOperation, type NormalizedState } from "@/modules/home-assistant";
import { assertTransition, type CommandState, isTerminal } from "../command-lifecycle";
import { type Authorizer, allowAll } from "./authorizer";
import { type CommandStore, InMemoryCommandStore } from "./command-store";
import type { CommandInput, DeviceCommand, FailureCode } from "./command-types";
import { type Expectation, expectationFor, isSensitiveOperation, validateParameters } from "./expectations";

/** How long to wait for the desired state after HA accepts a command. Movers and thermostats are slower. */
const DEFAULT_TIMEOUT_MS: Record<string, number> = { cover: 60_000, lock: 15_000, climate: 15_000, fan: 10_000, valve: 60_000 };
const FALLBACK_TIMEOUT_MS = 8_000;

export interface CommandExecutorDeps {
  manager: ConnectionManager;
  bus: EventBus<AppEvent>;
  log: Logger;
  store?: CommandStore;
  authorizer?: Authorizer;
  now?: () => number;
}

/**
 * The single path for device control. Pipeline:
 * validate → authorize → dispatch to HA → HA accepts → observe the desired state (or time out).
 * Confirmation is by desired state, not "the next state_changed", because a person may press a switch at the same time.
 */
export class CommandExecutor {
  private readonly store: CommandStore;
  private readonly authorizer: Authorizer;
  private readonly now: () => number;
  private readonly runs = new Map<string, Promise<DeviceCommand>>();

  constructor(private readonly deps: CommandExecutorDeps) {
    this.store = deps.store ?? new InMemoryCommandStore();
    this.authorizer = deps.authorizer ?? allowAll;
    this.now = deps.now ?? Date.now;
  }

  /** Creates the command and starts running it. Returns immediately with the `pending` command; follow it with `done()` or the bus. */
  submit(input: CommandInput): DeviceCommand {
    const domain = input.entityId.split(".")[0] ?? "";
    const cmd: DeviceCommand = {
      id: newId("cmd"), householdId: input.householdId, connectionId: null, entityId: input.entityId, domain,
      action: input.action, parameters: input.parameters ?? {}, state: "pending", requestedState: null, actualState: null,
      requestedBy: input.actor.userId, source: input.actor.source, haContextId: null, failure: null, confirmedBy: null,
      createdAt: this.now(), dispatchedAt: null, acceptedAt: null, finishedAt: null, timeoutAt: null,
    };
    this.store.create(cmd);
    this.publish("command.created", cmd);
    const run = this.run(cmd.id, input).catch((err) => this.fail(cmd.id, "ha_unreachable", `Unexpected error: ${String(err)}`));
    this.runs.set(cmd.id, run);
    void run.finally(() => this.runs.delete(cmd.id)); // finished runs are served from the store
    return cmd;
  }

  /** Resolves with the final command (confirmed, failed, timed out or cancelled). */
  done(id: string): Promise<DeviceCommand> {
    const run = this.runs.get(id);
    if (!run) {
      const c = this.store.get(id);
      return c ? Promise.resolve(c) : Promise.reject(new Error(`Unknown command ${id}`));
    }
    return run;
  }

  get(id: string) {
    return this.store.get(id);
  }

  list(filter?: Parameters<CommandStore["list"]>[0]) {
    return this.store.list(filter);
  }

  /** Cancels a command that has not been dispatched yet. */
  cancel(id: string): DeviceCommand {
    const cur = this.store.get(id);
    if (!cur) throw new Error(`Unknown command ${id}`);
    if (cur.state !== "pending" && cur.state !== "authorized") throw new Error(`Cannot cancel a ${cur.state} command`);
    return this.move(id, "cancelled", { finishedAt: this.now() });
  }

  // ---- pipeline ----

  private async run(id: string, input: CommandInput): Promise<DeviceCommand> {
    const cmd = this.store.get(id)!;
    const { entityId, domain, action } = cmd;
    const params = cmd.parameters;
    const stopped = () => isTerminal(this.store.get(id)!.state);

    // 1. Find the entity and check the operation is supported and well-formed.
    const found = this.find(input.householdId, entityId);
    if (!found) return this.fail(id, "unknown_entity", `No such device entity: ${entityId}`);
    const { conn, caps, projection } = found;
    this.store.update(id, { connectionId: conn.config.id });
    if (!supportsOperation(caps, action)) return this.fail(id, "unsupported_operation", `${entityId} does not support "${action}"`);
    const bad = validateParameters(action, params);
    if (bad) return this.fail(id, "invalid_parameters", bad);
    const call = resolveOperation(domain, action, params);
    if (!call) return this.fail(id, "unsupported_operation", `No Home Assistant service for "${action}" on ${domain}`);
    if (projection?.availability === "unavailable") return this.fail(id, "device_unavailable", `${entityId} is unavailable`);

    // 2. Authorize (permissions, then step-up for sensitive operations).
    const authz = await this.authorizer.authorize({ actor: input.actor, householdId: input.householdId, entityId, domain, action });
    if (stopped()) return this.store.get(id)!; // cancelled while authorizing
    if (!authz.allowed) return this.fail(id, "forbidden", authz.reason ?? "Not allowed");
    if (isSensitiveOperation(domain, action) && !input.actor.steppedUp) {
      return this.fail(id, "step_up_required", `"${action}" on ${entityId} needs a fresh passkey confirmation`);
    }
    this.move(id, "authorized");

    // 3. Work out what we expect to see, and start watching before we dispatch so no event is missed.
    const before: NormalizedState = projection?.normalized ?? {};
    const expectation = expectationFor(domain, action, params, before);
    this.store.update(id, { requestedState: expectation?.requested ?? null });
    const alreadyTrue = !!expectation && action !== "toggle" && expectation.matches(before);
    const watcher = expectation && !alreadyTrue ? this.watch(conn, entityId, expectation) : null;

    if (conn.status !== "connected") {
      watcher?.dispose();
      return this.fail(id, "ha_unreachable", "Home Assistant is not connected");
    }
    if (stopped()) { watcher?.dispose(); return this.store.get(id)!; }

    // 4. Dispatch, then HA acknowledges.
    this.move(id, "dispatched", { dispatchedAt: this.now() });
    let contextId: string;
    try {
      ({ contextId } = await conn.gateway.callService({ domain: call.domain, service: call.service, data: call.data, target: { entity_id: entityId } }));
    } catch (err) {
      watcher?.dispose();
      return this.fail(id, "ha_rejected", err instanceof Error ? err.message : String(err));
    }
    const timeoutMs = input.confirmTimeoutMs ?? DEFAULT_TIMEOUT_MS[domain] ?? FALLBACK_TIMEOUT_MS;
    this.move(id, "accepted", { acceptedAt: this.now(), haContextId: contextId, timeoutAt: this.now() + timeoutMs });

    // 5. Confirm.
    if (!expectation) return this.confirm(id, conn, "unobservable");
    if (alreadyTrue) return this.confirm(id, conn, "already");
    const outcome = await watcher!.wait(timeoutMs);
    return outcome === "state" ? this.confirm(id, conn, "state") : this.timeout(id);
  }

  /** Watches entity changes from now on; resolves when the expectation holds, including if it already matched mid-dispatch. */
  private watch(conn: ManagedConnection, entityId: string, exp: Expectation) {
    let matched = false;
    let onMatch: (() => void) | null = null;
    const unsub = this.deps.bus.subscribe("entity.state_changed", (e) => {
      if (e.connectionId !== conn.config.id || e.entityId !== entityId || !exp.matches(e.normalized)) return;
      matched = true;
      onMatch?.();
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dispose = () => { unsub(); if (timer) clearTimeout(timer); };
    return {
      dispose,
      wait: (timeoutMs: number) =>
        new Promise<"state" | "timeout">((resolve) => {
          const finish = (r: "state" | "timeout") => { dispose(); resolve(r); };
          if (matched || exp.matches(conn.cache.get(entityId)?.normalized ?? {})) return finish("state");
          onMatch = () => finish("state");
          timer = setTimeout(() => finish("timeout"), timeoutMs);
        }),
    };
  }

  private find(householdId: string, entityId: string) {
    for (const conn of this.deps.manager.forHousehold(householdId)) {
      const ent = conn.inventory?.entities.find((e) => e.entityId === entityId);
      if (ent) return { conn, caps: ent.capabilities, projection: conn.cache.get(entityId) };
    }
    return null;
  }

  // ---- state transitions ----

  private publish(type: CommandEvent["type"], command: DeviceCommand) {
    this.deps.bus.publish({ type, householdId: command.householdId, timestamp: new Date(this.now()).toISOString(), command });
  }

  private move(id: string, to: CommandState, patch: Partial<DeviceCommand> = {}): DeviceCommand {
    const cur = this.store.get(id)!;
    assertTransition(cur.state, to);
    const next = this.store.update(id, { ...patch, state: to });
    this.publish(`command.${to}` as CommandEvent["type"], next);
    return next;
  }

  private fail(id: string, code: FailureCode, message: string): DeviceCommand {
    const cur = this.store.get(id)!;
    if (isTerminal(cur.state)) return cur; // e.g. cancelled while we were failing
    this.deps.log.warn({ commandId: id, code, message }, "command failed");
    return this.move(id, "failed", { failure: { code, message }, finishedAt: this.now() });
  }

  private confirm(id: string, conn: ManagedConnection, by: NonNullable<DeviceCommand["confirmedBy"]>): DeviceCommand {
    const entityId = this.store.get(id)!.entityId;
    const done = this.move(id, "confirmed", { confirmedBy: by, actualState: conn.cache.get(entityId)?.normalized ?? null, finishedAt: this.now() });
    this.deps.log.info({ commandId: id, by, ms: done.finishedAt! - done.createdAt }, "command confirmed");
    return done;
  }

  private timeout(id: string): DeviceCommand {
    const cmd = this.store.get(id)!;
    const conn = this.deps.manager.get(cmd.connectionId ?? "");
    this.deps.log.warn({ commandId: id }, "command timed out waiting for the desired state");
    return this.move(id, "timed_out", {
      actualState: conn?.cache.get(cmd.entityId)?.normalized ?? null,
      failure: { code: "not_confirmed", message: "Home Assistant accepted the command but the expected state was not observed in time" },
      finishedAt: this.now(),
    });
  }
}
