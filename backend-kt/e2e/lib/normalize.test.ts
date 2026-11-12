// Unit tests for the normalizer (runbook §8.2 / T1.3). Every rule in the table has one test here,
// because a normalizer rule that is only exercised through a live card is a rule nobody can trust.
import { describe, expect, test } from "bun:test";
import { normalize, normalizeEqual } from "./normalize.ts";

const ULID = "usr_01M770ZXAZ4QFT5DTNWT8ESJC8";
const WINDOW = { start: Date.UTC(2025, 0, 1), end: Date.UTC(2025, 0, 1, 0, 10) };

describe("type-prefixed ULIDs", () => {
  test("become <id:prefix:length>, keeping the prefix and length comparable", () => {
    expect(normalize({ id: ULID })).toEqual({ id: "<id:usr:30>" });
  });

  test("the same prefix and length normalize equal", () => {
    const a = "dev_01M770ZXAZ4QFT5DTNWT8ESJC8";
    const b = "dev_01M770ZXBZ4QFT5DTNWT8ESJC9";
    expect(normalizeEqual({ id: a }, { id: b })).toBe(true);
  });

  test("a different length normalizes differently", () => {
    expect(normalize({ id: "usr_01M770ZXAZ4QFT5DTNWT8ESJC8" })).not.toEqual(
      normalize({ id: "usr_01M770ZXAZ4QFT5DTNWT8ESJC" }),
    );
  });

  test("embedded in a sentence, the prefix survives", () => {
    expect(normalize(`member ${ULID} joined`)).toBe("member <id:usr:30> joined");
  });

  test("repeated ids in nested objects normalize the same way (no regex lastIndex leak)", () => {
    expect(normalize({ x: { id: ULID }, y: { id: ULID } })).toEqual({
      x: { id: "<id:usr:30>" },
      y: { id: "<id:usr:30>" },
    });
  });
});

describe("timestamps", () => {
  test("ISO timestamps inside the window become <ts>", () => {
    expect(normalize({ at: "2025-01-01T00:05:00.000Z" }, { window: WINDOW })).toEqual({ at: "<ts>" });
  });

  test("ISO timestamps outside the window become <ts:out-of-window>", () => {
    expect(normalize({ at: "2026-11-12T04:00:00Z" }, { window: WINDOW })).toEqual({ at: "<ts:out-of-window>" });
  });

  test("unix-ms numbers inside the window become <ts>, outside become <ts:out-of-window>", () => {
    expect(normalize({ at: Date.UTC(2025, 0, 1, 0, 5) }, { window: WINDOW })).toEqual({ at: "<ts>" });
    expect(normalize({ at: 1_800_000_000_000 }, { window: WINDOW })).toEqual({ at: "<ts:out-of-window>" });
  });

  test("without a window, both sorts of timestamp become <ts>", () => {
    expect(normalize({ a: "2025-01-01T00:05:00.000Z", b: 1_800_000_000_000 })).toEqual({ a: "<ts>", b: "<ts>" });
  });

  test("a number outside the epoch-ms range is compared literally", () => {
    expect(normalize({ n: 42 })).toEqual({ n: 42 });
  });
});

describe("/health shape fields", () => {
  test("uptime becomes a number placeholder and version becomes <string>", () => {
    expect(normalize({ uptime: 12.5, version: "0.1.0" })).toEqual({ uptime: 0, version: "<string>" });
  });

  test("a wrong-typed uptime keeps its own type", () => {
    expect(normalize({ uptime: "12" })).toEqual({ uptime: "<not-number>" });
  });
});

describe("secrets", () => {
  test("challenges, tokens and codes become <secret:len>", () => {
    expect(
      normalize({
        challenge: "abc",
        setupCode: "12345678",
        token: "abcdef",
        recoveryCode: "AAAA-BBBB",
        invitationCode: "invite-me",
        signature: "MEYCIQ",
        clientDataJSON: "eyJ0eXBl",
        userHandle: "dXNy",
      }),
    ).toEqual({
      challenge: "<secret:3>",
      setupCode: "<secret:8>",
      token: "<secret:6>",
      recoveryCode: "<secret:9>",
      invitationCode: "<secret:9>",
      signature: "<secret:6>",
      clientDataJSON: "<secret:8>",
      userHandle: "<secret:4>",
    });
  });

  test("an array of recovery codes keeps its length", () => {
    expect(normalize({ recoveryCodes: ["aaaa", "bbbbbb"] })).toEqual({
      recoveryCodes: ["<secret:4>", "<secret:6>"],
    });
  });

  test("a secret of a different length is not equal", () => {
    expect(normalizeEqual({ token: "abc" }, { token: "abcd" })).toBe(false);
  });
});

describe("base64 credential ids", () => {
  test("a base64url credential id under `id` becomes <b64:len>", () => {
    expect(normalize({ id: "Cnw3HQ8azkL6WdKdRCDkiYZX12vksNwrkO_iBcPwWmE" })).toEqual({ id: "<b64:43>" });
  });
});

describe("arrays", () => {
  test("are ordered by default", () => {
    expect(normalizeEqual({ tags: ["b", "a"] }, { tags: ["a", "b"] })).toBe(false);
  });

  test("are sorted when the card marks the key unordered", () => {
    expect(normalizeEqual({ tags: ["b", "a"] }, { tags: ["a", "b"] }, { unordered: ["tags"] })).toBe(true);
  });

  test("a nested array uses its own key, not its parent's", () => {
    expect(normalize({ groups: [{ roles: ["b", "a"] }] }, { unordered: ["groups"] })).toEqual({
      groups: [{ roles: ["b", "a"] }],
    });
  });
});
