import { describe, expect, test } from "bun:test";
import { app } from "./app";
import { assertTransition, canTransition } from "./modules/devices/command-lifecycle";

describe("app", () => {
  test("GET /health", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  test("module stub is mounted", async () => {
    const res = await app.handle(new Request("http://localhost/api/devices"));
    expect(await res.json()).toEqual({ module: "devices", status: "not_implemented" });
  });
});

describe("command lifecycle", () => {
  test("allows the happy path", () => {
    expect(canTransition("pending", "authorized")).toBe(true);
    expect(canTransition("accepted", "confirmed")).toBe(true);
  });
  test("rejects invalid and post-terminal transitions", () => {
    expect(() => assertTransition("confirmed", "failed")).toThrow();
    expect(canTransition("dispatched", "cancelled")).toBe(false);
  });
});
