import { describe, expect, test } from "bun:test";
import { AppError } from "../errors/errors";
import { createTestDb } from "../database/client";
import { rateLimits } from "../database/schema";
import { clientIp, enforce, RateLimiter, SqliteBucketStore } from "./rate-limit";

describe("RateLimiter", () => {
  test("allows up to the limit per key, then blocks until the window ends", () => {
    let t = 0;
    const l = new RateLimiter({ limit: 3, windowMs: 1000 }, () => t);
    expect([1, 2, 3].map(() => l.hit("a").allowed)).toEqual([true, true, true]);
    const blocked = l.hit("a");
    expect(blocked).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    expect(l.hit("b").allowed).toBe(true); // other keys are independent
    t = 1001;
    expect(l.hit("a").allowed).toBe(true);
  });

  test("reset forgets a key", () => {
    const l = new RateLimiter({ limit: 1, windowMs: 1000 });
    l.hit("a"); expect(l.hit("a").allowed).toBe(false);
    l.reset("a"); expect(l.hit("a").allowed).toBe(true);
  });

  test("enforce throws a 429 with Retry-After", () => {
    const l = new RateLimiter({ limit: 1, windowMs: 90_000 });
    enforce(l, "k");
    try { enforce(l, "k"); throw new Error("should have thrown"); } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect(e).toMatchObject({ status: 429, code: "rate_limited", headers: { "retry-after": "90" } });
    }
  });
});

describe("clientIp", () => {
  const req = (h: Record<string, string> = {}) => new Request("http://x", { headers: h });
  const server = { requestIP: () => ({ address: "10.0.0.5" }) };
  test("uses the socket address; forwarded headers only when proxy is trusted", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4" }), server, false)).toBe("10.0.0.5");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }), server, true)).toBe("1.2.3.4");
    expect(clientIp(req(), server, true)).toBe("10.0.0.5");
    expect(clientIp(req(), null, false)).toBe("local");
  });
});

describe("counters kept in the database", () => {
  const mk = (db: ReturnType<typeof createTestDb>, now: () => number, name = "auth:") => new RateLimiter({ limit: 3, windowMs: 60_000 }, now, new SqliteBucketStore(db), name);

  test("a restart does not give everyone a fresh allowance: a new limiter over the same database still knows", () => {
    const db = createTestDb();
    let t = 1_000;
    const a = mk(db, () => t);
    for (let i = 0; i < 3; i++) expect(a.hit("1.2.3.4").allowed).toBe(true);
    expect(a.hit("1.2.3.4").allowed).toBe(false);
    const afterRestart = mk(db, () => t); // a new process, same file
    expect(afterRestart.hit("1.2.3.4").allowed).toBe(false);
    expect(afterRestart.hit("9.9.9.9").allowed).toBe(true);
    t += 61_000;
    expect(afterRestart.hit("1.2.3.4").allowed).toBe(true); // the window passed
  });

  test("limiters sharing one table stay apart, reset forgets a key, and expired rows are swept", () => {
    const db = createTestDb();
    let t = 1_000;
    const a = mk(db, () => t, "a:"), b = mk(db, () => t, "b:");
    for (let i = 0; i < 4; i++) a.hit("k");
    expect(b.hit("k").allowed).toBe(true);
    a.reset("k");
    expect(a.hit("k").remaining).toBe(2);
    t += 5 * 60_000;
    b.hit("other"); // triggers a sweep
    expect(db.select().from(rateLimits).all().map((r) => r.key).sort()).toEqual(["b:other"]);
  });
});
