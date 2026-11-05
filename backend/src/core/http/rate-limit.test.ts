import { describe, expect, test } from "bun:test";
import { AppError } from "@/core/errors/errors";
import { clientIp, enforce, RateLimiter } from "./rate-limit";

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
