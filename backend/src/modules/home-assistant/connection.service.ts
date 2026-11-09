import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../../core/database/client";
import { haConnections } from "../../core/database/schema";
import { AppError, notFound } from "../../core/errors/errors";
import type { AppEvent } from "../../core/events/app-events";
import type { EventBus } from "../../core/events/event-bus";
import { newId } from "../../core/ids";
import { writeAudit } from "../../core/security/audit";
import { decryptSecret, encryptSecret } from "../../core/security/secrets";
import { seal } from "../../core/security/sealed";
import { HaAuthError } from "./clients/ha-ws-gateway";
import type { ConnectionManager, GatewayFactory } from "./connections/connection-manager";

/**
 * The URL is entered by an admin and then fetched by this server, so keep it to plain http(s) hosts and refuse
 * link-local addresses (cloud metadata services live there). LAN and loopback addresses stay allowed: Home Assistant
 * normally lives on the LAN.
 */
export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new AppError(400, "validation_error", "That does not look like a URL (try http://homeassistant.local:8123)"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new AppError(400, "validation_error", "The URL must start with http:// or https://");
  if (u.username || u.password) throw new AppError(400, "validation_error", "Do not put credentials in the URL");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^169\.254\./.test(host) || host.startsWith("fe80:") || host === "metadata.google.internal") throw new AppError(400, "validation_error", "That address is not allowed");
  return u.origin;
}

export interface ConnectionView {
  configured: boolean;
  id?: string;
  name?: string;
  baseUrl?: string;
  status?: string;
  haVersion?: string | null;
  lastError?: string | null;
  lastConnectedAt?: number | null;
  entities?: number;
  syncedAt?: string | null;
  adminTokenSet?: boolean;
}

export class HaConnectionService {
  constructor(
    private readonly db: Db,
    private readonly manager: ConnectionManager,
    private readonly bus: EventBus<AppEvent>,
    private readonly createGateway: GatewayFactory,
    private readonly secretsKey: () => Buffer,
    /** Public half of the admin-token seal. This process can store the admin token but never read it back. */
    private readonly adminSealPublicKey: () => string | null,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {
    // Keep the stored status/error/version current as connections come and go.
    bus.subscribe("connection.connected", (e) => this.record(e.connectionId, { status: "connected", lastError: null, lastConnectedAt: this.now() }));
    bus.subscribe("connection.disconnected", (e) => this.record(e.connectionId, { status: e.status, lastError: e.error ?? null }));
  }

  private adminTokenHooks: ((householdId: string, userId: string) => void)[] = [];

  /** Runs after an admin token is stored, e.g. to push everything that was waiting for one. */
  afterAdminToken(fn: (householdId: string, userId: string) => void) {
    this.adminTokenHooks.push(fn);
  }

  private record(connectionId: string, patch: Partial<typeof haConnections.$inferInsert>) {
    const live = this.manager.get(connectionId);
    this.db.update(haConnections).set({ ...patch, haVersion: live?.haVersion ?? undefined, updatedAt: this.now() }).where(eq(haConnections.id, connectionId)).run();
  }

  private row(householdId: string) {
    return this.db.select().from(haConnections).where(eq(haConnections.householdId, householdId)).get();
  }

  get(householdId: string): ConnectionView {
    const r = this.row(householdId);
    if (!r) return { configured: false };
    const live = this.manager.get(r.id);
    return {
      configured: true, id: r.id, name: r.name, baseUrl: r.baseUrl, status: live?.status ?? r.status, haVersion: live?.haVersion ?? r.haVersion,
      lastError: live?.lastError ?? r.lastError, lastConnectedAt: r.lastConnectedAt, entities: live?.cache.size ?? 0, syncedAt: live?.inventory?.syncedAt ?? null, adminTokenSet: !!r.adminTokenEnc,
    };
  }

  /** Tries the credentials without saving anything. */
  async test(input: { baseUrl: string; token: string }): Promise<{ version: string; locationName: string | null }> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const gw = this.createGateway({ id: "test", householdId: "test", baseUrl, token: input.token });
    try {
      await gw.connect();
      const cfg = await gw.getConfig();
      return { version: cfg.version, locationName: cfg.location_name ?? null };
    } catch (err) {
      if (err instanceof HaAuthError) throw new AppError(400, "ha_token_rejected", "Home Assistant rejected that access token");
      throw new AppError(400, "ha_unreachable", `Could not reach Home Assistant at ${baseUrl}`);
    } finally {
      await gw.disconnect().catch(() => {});
    }
  }

  /** Validates, stores (token encrypted) and (re)starts the household's connection. One connection per household for now. */
  async save(householdId: string, actorId: string, input: { baseUrl: string; token: string; name?: string }): Promise<ConnectionView> {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const key = this.secretsKey();
    const info = await this.test({ baseUrl, token: input.token });
    const existing = this.row(householdId);
    const t = this.now();
    const enc = encryptSecret(input.token, key);
    let id: string;
    if (existing) {
      id = existing.id;
      await this.manager.remove(id);
      this.db.update(haConnections).set({ baseUrl, operationalTokenEnc: enc, name: input.name?.trim() || existing.name, status: "connecting", lastError: null, haVersion: info.version, updatedAt: t }).where(eq(haConnections.id, id)).run();
    } else {
      id = newId("hac");
      this.db.insert(haConnections).values({ id, householdId, name: input.name?.trim() || info.locationName || "Home Assistant", baseUrl, operationalTokenEnc: enc, status: "connecting", haVersion: info.version, createdAt: t, updatedAt: t }).run();
    }
    writeAudit(this.db, { householdId, actorId, action: "ha.connection_saved", resource: id, detail: { baseUrl, haVersion: info.version } }, t);
    try {
      await this.manager.add({ id, householdId, baseUrl, token: input.token });
    } catch (err) {
      this.log.error({ err: String(err) }, "HA connection saved but failed to start");
      throw new AppError(502, "ha_unreachable", "Saved, but the connection could not be started");
    }
    return this.get(householdId);
  }

  /** Stores the admin token for the config-worker, sealed with a public key so this process cannot read it back. */
  async setAdminToken(householdId: string, actorId: string, token: string) {
    const r = this.row(householdId);
    if (!r) throw notFound("Home Assistant connection");
    const pub = this.adminSealPublicKey();
    if (!pub) throw new AppError(503, "not_configured", "Admin token storage is not set up (ADMIN_SEAL_PUBLIC_KEY)");
    await this.test({ baseUrl: r.baseUrl, token });
    this.db.update(haConnections).set({ adminTokenEnc: seal(token, pub), updatedAt: this.now() }).where(eq(haConnections.id, r.id)).run();
    writeAudit(this.db, { householdId, actorId, action: "ha.admin_token_set", resource: r.id }, this.now());
    for (const fn of this.adminTokenHooks) fn(householdId, actorId);
  }

  async remove(householdId: string, actorId: string) {
    const r = this.row(householdId);
    if (!r) throw notFound("Home Assistant connection");
    await this.manager.remove(r.id);
    this.db.delete(haConnections).where(eq(haConnections.id, r.id)).run();
    writeAudit(this.db, { householdId, actorId, action: "ha.connection_removed", resource: r.id }, this.now());
  }

  async resync(householdId: string) {
    const r = this.row(householdId);
    const live = r && this.manager.get(r.id);
    if (!live) throw new AppError(409, "not_connected", "Home Assistant is not connected");
    await live.sync();
  }

  /** Starts every stored connection (called once at boot). Failures retry in the background. */
  startAll() {
    let key: Buffer;
    try { key = this.secretsKey(); } catch (err) {
      this.log.error({ err: String(err) }, "cannot start Home Assistant connections without SECRETS_KEY");
      return;
    }
    for (const r of this.db.select().from(haConnections).all()) {
      try {
        this.manager.addInBackground({ id: r.id, householdId: r.householdId, baseUrl: r.baseUrl, token: decryptSecret(r.operationalTokenEnc, key) });
      } catch (err) {
        this.log.error({ connectionId: r.id, err: String(err) }, "could not start stored Home Assistant connection");
      }
    }
  }
}
