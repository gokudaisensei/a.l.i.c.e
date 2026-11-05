import { expect, test } from "bun:test";
import { newId, ulid } from "./ids";

test("ulid is 26 chars and sorts by time", () => {
  const a = ulid(1_000), b = ulid(2_000);
  expect(a).toHaveLength(26);
  expect(a < b).toBe(true);
});
test("newId prefixes", () => {
  expect(newId("cmd")).toMatch(/^cmd_[0-9A-Z]{26}$/);
});
