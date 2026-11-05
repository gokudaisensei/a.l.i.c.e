import { describe, expect, test } from "bun:test";
import { generateSealKeyPair, open, pemFromEnv, pemToEnv, seal } from "./sealed";

const keys = generateSealKeyPair();

describe("sealed box", () => {
  test("the token can be sealed with the public key and opened only with the private key", () => {
    const token = "eyJ" + "x".repeat(200); // longer than RSA alone could carry
    const sealed = seal(token, keys.publicKey);
    expect(sealed).not.toContain("xxxx");
    expect(open(sealed, keys.privateKey)).toBe(token);
    expect(seal(token, keys.publicKey)).not.toBe(sealed); // fresh key and IV each time
  });
  test("the public key cannot open it, another private key cannot, and tampering is detected", () => {
    const sealed = seal("secret", keys.publicKey);
    expect(() => open(sealed, keys.publicKey)).toThrow();
    expect(() => open(sealed, generateSealKeyPair().privateKey)).toThrow();
    const parts = sealed.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => open(parts.join("."), keys.privateKey)).toThrow();
    expect(() => open("garbage", keys.privateKey)).toThrow(/format/);
  });
  test("keys survive the environment-variable encoding", () => {
    expect(pemFromEnv(pemToEnv(keys.privateKey))).toBe(keys.privateKey);
  });
});
