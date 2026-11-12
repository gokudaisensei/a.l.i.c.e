// Unit tests for the structural differ (runbook §8.2 / T1.4): each of the three kinds, the JSON
// paths, and the options the cards rely on.
import { describe, expect, test } from "bun:test";
import { diff, skeleton } from "./diff.ts";

const ULID_A = "usr_01M770ZXAZ4QFT5DTNWT8ESJC8";
const ULID_B = "usr_01M770ZXBZ4QFT5DTNWT8ESJC9";

describe("identical", () => {
  test("equal structures with different ids and timestamps normalize identical", () => {
    const r = diff(
      { id: ULID_A, at: "1970-01-01T00:20:00.000Z", nested: { ok: true, n: 3 } },
      { id: ULID_B, at: "1970-01-01T00:20:01.000Z", nested: { ok: true, n: 3 } },
    );
    expect(r.kind).toBe("identical");
    expect(r.differences).toEqual([]);
  });

  test("non-normalized comparison keeps the difference", () => {
    expect(diff({ id: ULID_A }, { id: ULID_B }, { normalized: false }).kind).not.toBe("identical");
  });
});

describe("shape-identical", () => {
  test("a differing scalar under the same key is shape-identical and names the path", () => {
    const r = diff({ id: ULID_A, name: "Kitchen" }, { id: ULID_B, name: "Bedroom" });
    expect(r.kind).toBe("shape-identical");
    expect(r.differences).toEqual([{ path: "$.name", left: "Kitchen", right: "Bedroom" }]);
  });

  test("a secret of a different length is shape-identical", () => {
    const r = diff({ token: "abc" }, { token: "abcd" });
    expect(r.kind).toBe("shape-identical");
    expect(r.differences[0]!.path).toBe("$.token");
  });
});

describe("different", () => {
  test("a missing key is reported at its path", () => {
    const r = diff({ a: 1 }, { a: 1, b: 2 });
    expect(r.kind).toBe("different");
    expect(r.differences).toContainEqual({ path: "$.b", left: "<missing>", right: 2 });
  });

  test("a changed type is different", () => {
    const r = diff({ uptime: 3 }, { uptime: "3" });
    expect(r.kind).toBe("different");
    expect(r.differences[0]!.path).toBe("$.uptime");
  });

  test("a null where the other side omits the field is different", () => {
    const r = diff({ a: null }, {});
    expect(r.kind).toBe("different");
    expect(r.differences).toContainEqual({ path: "$.a", left: null, right: "<missing>" });
  });

  test("array length and element paths are reported", () => {
    const r = diff({ xs: [1, 2] }, { xs: [1, 3, 4] });
    expect(r.kind).toBe("different");
    expect(r.differences.map((d) => d.path)).toContain("$.xs.length");
    expect(r.differences.map((d) => d.path)).toContain("$.xs[1]");
  });
});

describe("unordered arrays", () => {
  test("order does not matter when the key is marked unordered", () => {
    const r = diff({ tags: ["b", "a"] }, { tags: ["a", "b"] }, { unordered: ["tags"] });
    expect(r.kind).toBe("identical");
  });

  test("a different member is still reported", () => {
    const r = diff({ tags: ["a", "b"] }, { tags: ["a", "c"] }, { unordered: ["tags"] });
    expect(r.kind).toBe("shape-identical");
    expect(r.differences).toHaveLength(1);
  });
});

describe("skeleton", () => {
  test("keeps keys and types but drops values", () => {
    expect(skeleton({ a: 1, b: "x", c: [true] })).toEqual({ a: "number", b: "string", c: ["boolean"] });
  });
});
