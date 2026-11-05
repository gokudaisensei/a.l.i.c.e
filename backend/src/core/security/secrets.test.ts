import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, parseKey } from "./secrets";

const key = randomBytes(32);

describe("secrets", () => {
  test("round-trips, never stores the plain text, and uses a fresh IV each time", () => {
    const a = encryptSecret("eyJ-long-lived-token", key);
    const b = encryptSecret("eyJ-long-lived-token", key);
    expect(a).not.toContain("eyJ-long");
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("eyJ-long-lived-token");
  });
  test("tampering or the wrong key is detected", () => {
    const enc = encryptSecret("secret", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow();
    expect(() => decryptSecret("garbage", key)).toThrow(/format/);
  });
  test("key parsing is strict", () => {
    expect(() => parseKey(null)).toThrow(/not set/);
    expect(() => parseKey("c2hvcnQ=")).toThrow(/32 bytes/);
    expect(parseKey(key.toString("base64"))).toHaveLength(32);
  });
});
