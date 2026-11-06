import { eq, lte } from "drizzle-orm";
import type { Db } from "@/core/database/client";
import { rateLimits } from "@/core/database/schema";
import { AppError } from "@/core/errors/errors";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface HitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface Bucket { count: number; resetAt: number }

/** Where the counters live. */
export interface BucketStore {
  get(key: string): Bucket | undefined;
  set(key: string, b: Bucket): void;
  delete(key: string): void;
  /** Forget everything that has expired. */
  sweep(now: number): void;
}

export class MemoryBucketStore implements BucketStore {
  private m = new Map<string, Bucket>();
  get(key: string) { return this.m.get(key); }
  set(key: string, b: Bucket) { this.m.set(key, b); }
  delete(key: string) { this.m.delete(key); }
  sweep(now: number) { for (const [k, b] of this.m) if (b.resetAt <= now) this.m.delete(k); }
}

/** Counters in SQLite: they survive a restart and are shared by every process using the same database file. */
export class SqliteBucketStore implements BucketStore {
  constructor(private readonly db: Db) {}
  get(key: string) { return this.db.select({ count: rateLimits.count, resetAt: rateLimits.resetAt }).from(rateLimits).where(eq(rateLimits.key, key)).get(); }
  set(key: string, b: Bucket) { this.db.insert(rateLimits).values({ key, ...b }).onConflictDoUpdate({ target: rateLimits.key, set: b }).run(); }
  delete(key: string) { this.db.delete(rateLimits).where(eq(rateLimits.key, key)).run(); }
  sweep(now: number) { this.db.delete(rateLimits).where(lte(rateLimits.resetAt, now)).run(); }
}

/** Fixed-window counter per key. `name` keeps several limiters apart inside one shared store. */
export class RateLimiter {
  private lastSweep = 0;

  constructor(private readonly opts: RateLimitOptions, private readonly now: () => number = Date.now, private readonly store: BucketStore = new MemoryBucketStore(), private readonly name = "") {}

  hit(key: string): HitResult {
    const t = this.now();
    if (t - this.lastSweep > 60_000) { this.lastSweep = t; this.store.sweep(t); }
    const k = this.name + key;
    let b = this.store.get(k);
    if (!b || b.resetAt <= t) b = { count: 0, resetAt: t + this.opts.windowMs };
    b = { count: b.count + 1, resetAt: b.resetAt };
    this.store.set(k, b);
    return { allowed: b.count <= this.opts.limit, remaining: Math.max(0, this.opts.limit - b.count), retryAfterMs: Math.max(0, b.resetAt - t) };
  }

  /** Forget a key, e.g. after a successful sign-in. */
  reset(key: string) {
    this.store.delete(this.name + key);
  }
}

/** Counts a hit and throws 429 with Retry-After when over the limit. */
export function enforce(limiter: RateLimiter, key: string) {
  const r = limiter.hit(key);
  if (!r.allowed) {
    const secs = Math.max(1, Math.ceil(r.retryAfterMs / 1000));
    throw new AppError(429, "rate_limited", `Too many attempts. Try again in ${secs} seconds`, { "retry-after": String(secs) });
  }
}

/** Client address. Forwarded headers are only trusted behind a proxy you control (TRUST_PROXY=true). */
export function clientIp(request: Request, server: { requestIP?: (r: Request) => { address: string } | null } | null | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  return server?.requestIP?.(request)?.address ?? "local";
}

export interface Limits {
  /** All public auth endpoints, per IP. */
  auth: RateLimiter;
  /** Endpoints where a guess wins something (recovery codes, invitation codes), per IP. */
  secrets: RateLimiter;
  /** Same endpoints across all IPs, against distributed guessing. */
  secretsGlobal: RateLimiter;
}

/** With a database the counters are kept in it; without one (unit tests of the limiter itself) they stay in memory. */
export const createLimits = (now?: () => number, db?: Db): Limits => {
  const store = db ? new SqliteBucketStore(db) : undefined;
  return {
    auth: new RateLimiter({ limit: 30, windowMs: 60_000 }, now, store, "auth:"),
    secrets: new RateLimiter({ limit: 10, windowMs: 15 * 60_000 }, now, store, "secrets:"),
    secretsGlobal: new RateLimiter({ limit: 100, windowMs: 60 * 60_000 }, now, store, "secretsGlobal:"),
  };
};
