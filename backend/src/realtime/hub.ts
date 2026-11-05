import type { Logger } from "pino";
import type { Role } from "@/core/database/schema";
import type { AppEvent } from "@/core/events/app-events";
import type { EventBus, Unsubscribe } from "@/core/events/event-bus";
import { RateLimiter } from "@/core/http/rate-limit";
import type { AuthService, SessionContext } from "@/modules/authentication/auth.service";
import { toPublicCommand } from "@/modules/devices/commands/public-command";
import type { Caller, DevicesService } from "@/modules/devices/devices.service";
import type { AlertsService } from "@/modules/notifications/alerts.service";
import type { NotificationsService } from "@/modules/notifications/notifications.service";
import type { ManagedConnection } from "@/modules/home-assistant";
import { describeThingFacets } from "@/modules/home-assistant/things/facet-values";
import type { ThingsService } from "@/modules/home-assistant/things/things.service";
import type { Thing, ThingOverrides } from "@/modules/home-assistant/things/types";
import type { HouseholdService, Membership } from "@/modules/households/household.service";
import { evaluateDeviceAccess, type DevicePolicyRow } from "@/modules/permissions/device-access";
import type { PermissionService } from "@/modules/permissions/permission.service";
import { can } from "@/modules/permissions/permissions";

/** What the hub needs from a socket. The Elysia adapter and test fakes both implement it. */
export interface ClientSocket {
  id: string;
  send(msg: ServerMessage): void;
  close(code: number, reason: string): void;
  /** Bytes queued for this client. Slow consumers are dropped instead of buffered forever. */
  bufferedAmount?(): number;
}

export interface ServerMessage {
  type: string;
  data?: unknown;
  requestId?: string;
  ts: number;
}

export const RESOURCES = ["devices", "device", "area", "commands", "household", "alerts", "notifications"] as const;
type Resource = (typeof RESOURCES)[number];

export const WS_LIMITS = { subscriptions: 50, connectionsPerUser: 10, maxBuffered: 1_000_000, messages: { limit: 60, windowMs: 10_000 }, recheckMs: 2_000 };

interface Client {
  socket: ClientSocket;
  userId: string;
  sessionId: string;
  householdId: string;
  role: Role;
  checkedAt: number;
  subs: Set<string>;
}

interface Located {
  thing: Thing;
  conn: ManagedConnection;
  overrides: ThingOverrides;
}

const key = (r: Resource, id?: string) => (id ? `${r}:${id}` : r);

/**
 * Pushes changes to connected clients. Every event is filtered per person: they get an update only for
 * devices they may see, commands they sent (admins: all), and connection health if they manage Home Assistant.
 */
export class RealtimeHub {
  private clients = new Map<string, Client>();
  private unsub: Unsubscribe | null = null;
  private thingIndex = new WeakMap<Thing[], Map<string, Thing>>();
  private messageLimiter: RateLimiter;

  constructor(
    private readonly deps: {
      bus: EventBus<AppEvent>;
      things: ThingsService;
      permissions: PermissionService;
      households: HouseholdService;
      auth: AuthService;
      devices: DevicesService;
      alerts: AlertsService;
      notifications: NotificationsService;
      log: Logger;
      now?: () => number;
    },
  ) {
    this.messageLimiter = new RateLimiter(WS_LIMITS.messages, deps.now);
  }

  private now = () => this.deps.now?.() ?? Date.now();

  start() {
    this.unsub = this.deps.bus.subscribeAll((e) => this.onEvent(e));
  }

  stop() {
    this.unsub?.();
    this.unsub = null;
  }

  /** Tells every client the server is going away (1001) so they reconnect cleanly instead of seeing a dropped connection. */
  closeAll(reason = "Server shutting down") {
    for (const c of [...this.clients.values()]) this.drop(c, 1001, reason);
  }

  get connectionCount() {
    return this.clients.size;
  }

  // ---- connections ----

  /** Registers an authenticated socket. Returns false (and closes it) if the user has too many open connections. */
  connect(socket: ClientSocket, session: SessionContext, membership: Membership): boolean {
    const open = [...this.clients.values()].filter((c) => c.userId === session.userId).length;
    if (open >= WS_LIMITS.connectionsPerUser) {
      socket.close(4429, "Too many connections");
      return false;
    }
    this.clients.set(socket.id, {
      socket, userId: session.userId, sessionId: session.sessionId, householdId: membership.householdId, role: membership.role, checkedAt: this.now(), subs: new Set(),
    });
    this.send(socket, { type: "hello", data: { userId: session.userId, role: membership.role, resources: RESOURCES } });
    return true;
  }

  disconnect(id: string) {
    this.clients.delete(id);
    this.messageLimiter.reset(id);
  }

  /** Drops clients whose session ended or who lost access. Run on a timer. */
  sweep() {
    for (const c of [...this.clients.values()]) {
      const m = this.deps.households.getMembership(c.userId);
      if (!this.deps.auth.isSessionActive(c.sessionId) || !m || m.householdId !== c.householdId) this.drop(c, 4401, "Session ended");
      else c.role = m.role;
    }
  }

  private drop(c: Client, code: number, reason: string) {
    this.clients.delete(c.socket.id);
    try { c.socket.close(code, reason); } catch { /* already gone */ }
  }

  /** Re-reads the person's role at most every couple of seconds so demotions take effect quickly. */
  private fresh(c: Client): boolean {
    if (this.now() - c.checkedAt < WS_LIMITS.recheckMs) return true;
    c.checkedAt = this.now();
    const m = this.deps.households.getMembership(c.userId);
    if (!m || m.householdId !== c.householdId) { this.drop(c, 4401, "Access ended"); return false; }
    c.role = m.role;
    return true;
  }

  private send(socket: ClientSocket, msg: Omit<ServerMessage, "ts">) {
    const c = this.clients.get(socket.id);
    if (socket.bufferedAmount && socket.bufferedAmount() > WS_LIMITS.maxBuffered) {
      if (c) this.drop(c, 1013, "Too slow");
      return;
    }
    try { socket.send({ ...msg, ts: this.now() }); } catch (err) { this.deps.log.debug({ err: String(err) }, "ws send failed"); }
  }

  // ---- messages from clients ----

  receive(id: string, raw: unknown) {
    const c = this.clients.get(id);
    if (!c) return;
    const reply = (m: Omit<ServerMessage, "ts">) => this.send(c.socket, m);
    if (!this.messageLimiter.hit(id).allowed) return reply({ type: "error", data: { code: "rate_limited", message: "Slow down" } });

    let msg: any = raw;
    if (typeof raw === "string") { try { msg = JSON.parse(raw); } catch { return reply({ type: "error", data: { code: "bad_message", message: "Messages must be JSON" } }); } }
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return reply({ type: "error", data: { code: "bad_message", message: "Missing type" } });
    const requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 64) : undefined;
    const fail = (code: string, message: string) => reply({ type: "error", requestId, data: { code, message, resource: msg.resource, id: msg.id } });

    if (msg.type === "ping") return reply({ type: "pong", requestId });
    if (msg.type !== "subscribe" && msg.type !== "unsubscribe") return fail("unknown_message_type", `Unknown message type "${msg.type}"`);
    if (!this.fresh(c)) return;

    if (!(RESOURCES as readonly string[]).includes(msg.resource)) return fail("unknown_resource", `Unknown resource "${msg.resource}"`);
    const resource = msg.resource as Resource;
    const needsId = resource === "device" || resource === "area";
    if (needsId && (typeof msg.id !== "string" || !msg.id)) return fail("validation_error", `${resource} needs an id`);
    if (!needsId && msg.id !== undefined) return fail("validation_error", `${resource} does not take an id`);
    const k = key(resource, needsId ? msg.id : undefined);

    if (msg.type === "unsubscribe") {
      c.subs.delete(k);
      return reply({ type: "unsubscribed", requestId, data: { resource, id: msg.id } });
    }
    if (c.subs.size >= WS_LIMITS.subscriptions && !c.subs.has(k)) return fail("too_many_subscriptions", "Too many subscriptions");
    if (resource === "device") {
      try { this.deps.devices.get({ householdId: c.householdId, userId: c.userId, role: c.role, steppedUp: false }, msg.id); }
      catch { return fail("not_found", "No such device"); } // same answer whether it is missing or not theirs
    }
    // "household" is open to everyone: mode changes go to all, connection health only to admins (see onConnection).
    c.subs.add(k);
    reply({ type: "subscribed", requestId, data: { resource, id: msg.id } });
  }

  // ---- events from the bus ----

  private locate(householdId: string, connectionId: string, entityId: string): Located | null {
    for (const ct of this.deps.things.forHousehold(householdId)) {
      if (ct.conn.config.id !== connectionId) continue;
      let idx = this.thingIndex.get(ct.things);
      if (!idx) {
        idx = new Map(ct.things.flatMap((t) => t.entityIds.map((e) => [e, t] as const)));
        this.thingIndex.set(ct.things, idx);
      }
      const thing = idx.get(entityId);
      return thing ? { thing, conn: ct.conn, overrides: ct.overrides } : null;
    }
    return null;
  }

  private forHousehold(householdId: string) {
    return [...this.clients.values()].filter((c) => c.householdId === householdId && this.fresh(c));
  }

  private onEvent(e: AppEvent) {
    try {
      switch (e.type) {
        case "entity.state_changed":
        case "entity.availability_changed": return this.onEntity(e);
        case "entity.removed":
        case "registry.updated":
        case "inventory.synced": return this.changed(e.householdId, "inventory");
        case "things.changed": return this.changed(e.householdId, e.reason);
        case "household.mode_changed": return this.onMode(e);
        case "insights.changed": return this.onInsights(e);
        case "presence.changed": return this.onPresence(e);
        case "alert.created":
        case "alert.cleared": return this.onAlert(e);
        case "notification.created": return this.onNotification(e);
        case "connection.connected":
        case "connection.disconnected": return this.onConnection(e);
        default:
          if (e.type.startsWith("command.")) return this.onCommand(e as Extract<AppEvent, { type: `command.${string}` }>);
      }
    } catch (err) {
      this.deps.log.error({ err: String(err), type: e.type }, "realtime delivery failed");
    }
  }

  private onEntity(e: Extract<AppEvent, { type: "entity.state_changed" | "entity.availability_changed" }>) {
    const recipients = this.forHousehold(e.householdId).filter((c) => c.subs.size > 0);
    if (!recipients.length) return;
    const at = this.locate(e.householdId, e.connectionId, e.entityId);
    if (!at || at.thing.hidden) return;
    const { thing, conn, overrides } = at;
    const policies: DevicePolicyRow[] = this.deps.permissions.listPolicies(e.householdId).filter((p) => p.entityId === e.entityId);
    const entity = [thing.primary, ...thing.others, ...thing.controls, ...thing.sensors, ...thing.facets].find((x) => x?.entityId === e.entityId);
    const facet = thing.facets.find((f) => f.entityId === e.entityId);
    const proj = conn.cache.get(e.entityId);

    for (const c of recipients) {
      const wanted = c.subs.has("devices") || c.subs.has(key("device", thing.id)) || (thing.areaId !== null && c.subs.has(key("area", thing.areaId)));
      if (!wanted) continue;
      if (!evaluateDeviceAccess({ role: c.role, userId: c.userId, connectionId: e.connectionId, entityId: e.entityId, policies }).allowed) continue;
      if (!entity) continue; // diagnostics and config entities are not pushed
      if (e.type === "entity.availability_changed") {
        this.send(c.socket, { type: "entity.availability_changed", data: { thingId: thing.id, entityId: e.entityId, availability: e.availability } });
        continue;
      }
      this.send(c.socket, {
        type: "entity.updated",
        data: {
          thingId: thing.id, entityId: e.entityId, role: entity.role, availability: proj?.availability ?? "unknown", values: e.normalized, lastChanged: e.lastChanged,
          ...(facet ? { facet: { ...describeThingFacets({ ...thing, facets: [facet] }, (id) => conn.cache.get(id), overrides)[0]!, name: facet.name } } : {}),
        },
      });
    }
  }

  /** The shape of the device list changed; clients refetch it. */
  private changed(householdId: string, reason: string) {
    for (const c of this.forHousehold(householdId)) {
      if ([...c.subs].some((s) => s === "devices" || s.startsWith("device:") || s.startsWith("area:"))) this.send(c.socket, { type: "devices.changed", data: { reason } });
    }
  }

  private onCommand(e: Extract<AppEvent, { type: `command.${string}` }>) {
    const cmd = e.command;
    for (const c of this.forHousehold(e.householdId)) {
      if (!c.subs.has("commands")) continue;
      if (c.role !== "admin" && cmd.requestedBy !== c.userId) continue;
      this.send(c.socket, { type: e.type, data: toPublicCommand(cmd) });
    }
  }

  private onInsights(e: Extract<AppEvent, { type: "insights.changed" }>) {
    for (const c of this.forHousehold(e.householdId)) {
      if (c.subs.has("household") && can(c.role, "mode.change")) this.send(c.socket, { type: "insights.changed", data: {} });
    }
  }

  /** Who is home is for members and admins, not guests. */
  private onPresence(e: Extract<AppEvent, { type: "presence.changed" }>) {
    for (const c of this.forHousehold(e.householdId)) {
      if (c.subs.has("household") && can(c.role, "members.view")) this.send(c.socket, { type: "presence.changed", data: { userId: e.userId, personEntityId: e.personEntityId, home: e.home } });
    }
  }

  private onAlert(e: Extract<AppEvent, { type: "alert.created" | "alert.cleared" }>) {
    for (const c of this.forHousehold(e.householdId)) {
      if (!c.subs.has("alerts") || !can(c.role, "notification.receive")) continue;
      const who: Caller = { householdId: c.householdId, userId: c.userId, role: c.role, steppedUp: false };
      const alert = this.deps.alerts.viewFor(who, e.alertId); // each person only hears about devices they can see
      if (alert) this.send(c.socket, { type: e.type, data: alert });
    }
  }

  private onNotification(e: Extract<AppEvent, { type: "notification.created" }>) {
    const n = this.deps.notifications.get(e.userId, e.notificationId);
    if (!n) return;
    for (const c of this.forHousehold(e.householdId)) {
      if (c.userId === e.userId && c.subs.has("notifications")) this.send(c.socket, { type: "notification.created", data: n });
    }
  }

  private onMode(e: Extract<AppEvent, { type: "household.mode_changed" }>) {
    for (const c of this.forHousehold(e.householdId)) {
      if (c.subs.has("household")) this.send(c.socket, { type: "household.mode_changed", data: { mode: e.mode, previous: e.previous, changedBy: e.changedBy } });
    }
  }

  private onConnection(e: Extract<AppEvent, { type: "connection.connected" | "connection.disconnected" }>) {
    for (const c of this.forHousehold(e.householdId)) {
      if (!c.subs.has("household") || !can(c.role, "ha.manage")) continue;
      this.send(c.socket, { type: e.type, data: { connectionId: e.connectionId, status: e.status, ...(e.type === "connection.disconnected" && e.error ? { error: e.error } : {}) } });
    }
  }
}
