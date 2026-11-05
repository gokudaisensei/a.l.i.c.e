import { expect, test } from "bun:test";
import { Backoff } from "./backoff";

test("grows exponentially and caps", () => {
  const b = new Backoff({ baseMs: 100, maxMs: 1000, jitter: 0, random: () => 0 });
  expect([b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([100, 200, 400, 800, 1000]);
});

test("jitter stays within [delay*(1-j), delay]", () => {
  const lo = new Backoff({ baseMs: 1000, jitter: 0.5, random: () => 0 });
  const hi = new Backoff({ baseMs: 1000, jitter: 0.5, random: () => 1 });
  expect(lo.next()).toBe(500);
  expect(hi.next()).toBe(1000);
});

test("reset starts over", () => {
  const b = new Backoff({ baseMs: 100, jitter: 0, random: () => 0 });
  b.next(); b.next(); b.reset();
  expect(b.next()).toBe(100);
});
