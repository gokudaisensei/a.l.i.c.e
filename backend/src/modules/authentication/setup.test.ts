import { expect, test } from "bun:test";
import { createWorld } from "../../testing/world";

test("/auth/setup says a new install needs setup until the first person registers", async () => {
  const w = createWorld();
  const b = w.browser();
  expect((await b.call("GET", "/auth/setup")).json).toEqual({ needsSetup: true });
  await b.register("Gokul");
  expect((await w.browser().call("GET", "/auth/setup")).json).toEqual({ needsSetup: false });
});
