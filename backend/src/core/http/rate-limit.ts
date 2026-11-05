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

/** Fixed-window counter per key, in memory. Fine for one process; a shared store would replace it for several. */
export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly opts: RateLimitOptions, private readonly now: () => number = Date.now) {}

  hit(key: string): HitResult {
    const t = this.now();
    if (this.buckets.size > 10_000) this.sweep(t);
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.opts.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return { allowed: b.count <= this.opts.limit, remaining: Math.max(0, this.opts.limit - b.count), retryAfterMs: Math.max(0, b.resetAt - t) };
  }

  /** Forget a key, e.g. after a successful sign-in. */
  reset(key: string) {
    this.buckets.delete(key);
  }

  private sweep(t: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
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

export const createLimits = (now?: () => number): Limits => ({
  auth: new RateLimiter({ limit: 30, windowMs: 60_000 }, now),
  secrets: new RateLimiter({ limit: 10, windowMs: 15 * 60_000 }, now),
  secretsGlobal: new RateLimiter({ limit: 100, windowMs: 60 * 60_000 }, now),
});
