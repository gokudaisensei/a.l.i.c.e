import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inWindow } from "./update.service";
import { generateKeyPairSync } from "node:crypto";
import { isNewer, ManifestUpdateSource, MarkerFileInstaller, signManifest } from "./sources";

describe("versions", () => {
  test("compares semver with pre-releases", () => {
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "0.2.0-rc.1")).toBe(true);
    expect(isNewer("0.2.0-rc.1", "0.2.0")).toBe(false);
  });
});

describe("window", () => {
  test("handles windows inside a day and across midnight", () => {
    expect(inWindow(2 * 60, "02:00", "04:00")).toBe(true);
    expect(inWindow(4 * 60, "02:00", "04:00")).toBe(false);
    expect(inWindow(23 * 60, "22:00", "03:00")).toBe(true);
    expect(inWindow(1 * 60, "22:00", "03:00")).toBe(true);
    expect(inWindow(12 * 60, "22:00", "03:00")).toBe(false);
  });
});

describe("sources", () => {
  const json = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  test("reads a manifest and rejects bad ones", async () => {
    expect(await new ManifestUpdateSource("http://x", null, json({ version: "0.2.0", notes: "Fixes", publishedAt: "2026-11-01T00:00:00Z" })).latest()).toMatchObject({ version: "0.2.0", notes: "Fixes", publishedAt: Date.parse("2026-11-01T00:00:00Z") });
    await expect(new ManifestUpdateSource("http://x", null, json({ version: "latest" })).latest()).rejects.toThrow(/valid version/);
    await expect(new ManifestUpdateSource("http://x", null, json({}, 500)).latest()).rejects.toThrow(/500/);
  });
  test("with a publisher key only a correctly signed manifest is accepted; any tampered field breaks it", async () => {
    const pair = (k = generateKeyPairSync("ed25519")) => ({ pub: k.publicKey.export({ type: "spki", format: "pem" }).toString(), priv: k.privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    const a = pair(), other = pair();
    const m = { version: "0.2.0", notes: "Fixes", publishedAt: "2026-11-01T00:00:00Z", artifactSha256: "a".repeat(64) };
    const good = signManifest(m, a.priv);
    expect(await new ManifestUpdateSource("http://x", a.pub, json(good)).latest()).toMatchObject({ version: "0.2.0", signed: true, artifactSha256: "a".repeat(64) });
    for (const bad of [{ ...good, version: "9.9.9" }, { ...good, notes: "Evil" }, { ...good, artifactSha256: "b".repeat(64) }, { ...good, signature: undefined }, signManifest(m, other.priv)])
      await expect(new ManifestUpdateSource("http://x", a.pub, json(bad)).latest()).rejects.toThrow(/not signed/);
    // no key configured: accepted, but not marked signed
    expect((await new ManifestUpdateSource("http://x", null, json(good)).latest())!.signed).toBe(false);
  });
  test("the marker file names the version for a supervisor", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "alice-upd-")), "sub", "update-requested.json");
    await new MarkerFileInstaller(f, () => 42).request("0.2.0");
    await new MarkerFileInstaller(f, () => 43).request("0.1.0", "rollback");
    expect(JSON.parse(readFileSync(f, "utf8"))).toMatchObject({ kind: "rollback", version: "0.1.0" });
    await new MarkerFileInstaller(f, () => 42).request("0.2.0");
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ kind: "install", version: "0.2.0", artifactSha256: null, requestedAt: 42 });
  });
});
