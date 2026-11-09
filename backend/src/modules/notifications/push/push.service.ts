import { and, asc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import type { Db } from "../../../core/database/client";
import { households, notifications, pushSubscriptions, userPreferences } from "../../../core/database/schema";
import { AppError, notFound } from "../../../core/errors/errors";
import { newId } from "../../../core/ids";
import { RateLimiter } from "../../../core/http/rate-limit";
import { timeOfDay } from "../../insights/insights.service";
import type { HouseholdService } from "../../households/household.service";
import type { PushPayload, PushProvider, PushSubscription } from "./provider";

export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/** Web Push endpoints this server will call. Anything else could turn "register a phone" into "make the server call any URL". */
const WEBPUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

export type RegisterInput =
  | { platform: "webpush"; token: string; keys: { p256dh: string; auth: string }; label?: string }
  | { platform: "fcm"; token: string; keys?: undefined; label?: string };

export interface NotificationToPush {
  id: string;
  householdId: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  urgent: boolean;
}

const b64url = /^[A-Za-z0-9_-]{16,200}$/;

/**
 * Sends notifications to people's phones and browsers. Respects each person's push setting and quiet hours (urgent
 * notifications get through), forgets subscriptions the device has dropped, and never lets a push failure break anything.
 */
export class PushService {
  private limiter: RateLimiter;

  constructor(
    private readonly db: Db,
    private readonly providers: PushProvider[],
    private readonly households: HouseholdService,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.limiter = new RateLimiter({ limit: 30, windowMs: 10 * 60_000 }, now); // a runaway automation must not flood a phone
  }

  /** Which platforms can be used, so the app knows what to register. */
  platforms() {
    return this.providers.map((p) => p.platform);
  }

  /** The key a browser needs to subscribe to Web Push, if Web Push is set up. */
  vapidPublicKey(): string | null {
    const p = this.providers.find((x) => x.platform === "webpush") as ({ publicKey?: string } & PushProvider) | undefined;
    return p?.publicKey ?? null;
  }

  // ---- subscriptions ----

  register(userId: string, input: RegisterInput): PushSubscription {
    if (!this.providers.some((p) => p.platform === input.platform)) throw new AppError(409, "push_not_configured", `This server is not set up to send ${input.platform === "fcm" ? "Firebase" : "Web Push"} notifications`);
    if (input.platform === "webpush") {
      let u: URL;
      try { u = new URL(input.token); } catch { throw new AppError(400, "validation_error", "The subscription endpoint is not a URL"); }
      if (u.protocol !== "https:" || u.username || u.password || !WEBPUSH_HOSTS.some((re) => re.test(u.hostname))) throw new AppError(400, "validation_error", "That push service is not supported");
      if (!input.keys || !b64url.test(input.keys.p256dh) || !b64url.test(input.keys.auth)) throw new AppError(400, "validation_error", "The subscription keys are missing or malformed");
    } else if (input.token.length < 20 || input.token.length > 4096) throw new AppError(400, "validation_error", "That does not look like a device token");

    const existing = this.db.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.platform, input.platform), eq(pushSubscriptions.token, input.token))).get();
    if (existing) {
      this.db.update(pushSubscriptions).set({ keys: input.keys ?? null, label: input.label?.slice(0, 80) ?? existing.label }).where(eq(pushSubscriptions.id, existing.id)).run();
      return this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, existing.id)).get()!;
    }
    if (this.list(userId).length >= MAX_SUBSCRIPTIONS_PER_USER) throw new AppError(409, "too_many_devices", `At most ${MAX_SUBSCRIPTIONS_PER_USER} devices per person; remove one first`);
    const row = { id: newId("psh"), userId, platform: input.platform, token: input.token, keys: input.keys ?? null, label: input.label?.slice(0, 80) ?? null, createdAt: this.now(), lastUsedAt: null };
    this.db.insert(pushSubscriptions).values(row).run();
    return row;
  }

  list(userId: string) {
    return this.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(asc(pushSubscriptions.createdAt)).all();
  }

  unregister(userId: string, id: string) {
    const hit = this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, userId))).returning({ id: pushSubscriptions.id }).all();
    if (!hit.length) throw notFound("Device");
  }

  // ---- delivery ----

  /** Is it quiet time for this person (in the household's time zone)? */
  private inQuietHours(userId: string, householdId: string): boolean {
    const prefs = this.db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
    const q = prefs?.quietHours;
    if (!q?.enabled || !q.from || !q.to) return false;
    const tz = this.db.select({ tz: households.timezone }).from(households).where(eq(households.id, householdId)).get()?.tz ?? "UTC";
    const { label } = timeOfDay(this.now(), tz);
    const m = /^(\d{1,2}):(\d{2}) (am|pm)$/.exec(label);
    if (!m) return false;
    const nowMin = (Number(m[1]) % 12 + (m[3] === "pm" ? 12 : 0)) * 60 + Number(m[2]);
    const toMin = (hhmm: string) => { const [h, mm] = hhmm.split(":").map(Number) as [number, number]; return h * 60 + mm; };
    const [from, to] = [toMin(q.from), toMin(q.to)];
    return from <= to ? nowMin >= from && nowMin < to : nowMin >= from || nowMin < to; // quiet hours usually run overnight
  }

  /** Pushes one notification to the person's devices. Returns what happened, and records it on the notification. */
  async deliver(n: NotificationToPush): Promise<"none" | "sent" | "suppressed" | "failed"> {
    const record = (status: "none" | "sent" | "suppressed" | "failed") => { this.db.update(notifications).set({ pushStatus: status }).where(eq(notifications.id, n.id)).run(); return status; };
    try {
      const prefs = this.db.select().from(userPreferences).where(eq(userPreferences.userId, n.userId)).get();
      if (prefs && !prefs.pushEnabled) return record("suppressed");
      if (!n.urgent && this.inQuietHours(n.userId, n.householdId)) return record("suppressed");
      const subs = this.list(n.userId);
      if (!subs.length) return record("none");
      if (!this.limiter.hit(n.userId).allowed) return record("suppressed");

      const payload: PushPayload = { title: n.title, body: n.body, data: { notificationId: n.id, kind: n.kind } };
      let sent = 0;
      for (const sub of subs) {
        const provider = this.providers.find((p) => p.platform === sub.platform);
        if (!provider) continue;
        const r = await provider.send(sub, payload);
        if (r === "sent") { sent++; this.db.update(pushSubscriptions).set({ lastUsedAt: this.now() }).where(eq(pushSubscriptions.id, sub.id)).run(); }
        else if (r === "gone") this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run();
        else this.log.warn({ subscriptionId: sub.id, platform: sub.platform }, "push delivery failed");
      }
      return record(sent > 0 ? "sent" : "failed");
    } catch (err) {
      this.log.error({ err: String(err) }, "push delivery crashed");
      return record("failed");
    }
  }

  /** A test push to one's own devices, ignoring quiet hours and the rate limit. */
  async sendTest(userId: string): Promise<{ sent: number; removed: number; failed: number }> {
    const out = { sent: 0, removed: 0, failed: 0 };
    for (const sub of this.list(userId)) {
      const r = await this.providers.find((p) => p.platform === sub.platform)?.send(sub, { title: "Alice", body: "Notifications are working on this device.", data: { kind: "test" } });
      if (r === "sent") out.sent++;
      else if (r === "gone") { out.removed++; this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id)).run(); }
      else out.failed++;
    }
    return out;
  }
}
