import { beforeEach, describe, expect, test } from "bun:test";
import { createWorld, homeWithHa, type World } from "@/testing/world";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
const NOON = Date.parse("2026-11-05T12:00:00Z"); // a Thursday; the last finished evening is Wednesday the 4th
const DAY = 86_400_000;
const hour = (ms: number, change: number) => ({ start: ms, end: ms + 3_600_000, change });
/** Evening hours 17:00-22:00 UTC of the Wednesday `weeksBack` weeks before the 4th, each using `kwh` in total. */
const evening = (weeksBack: number, kwh: number) => {
  const day = Date.parse("2026-11-04T00:00:00Z") - weeksBack * 7 * DAY;
  return [17, 18, 19, 20, 21, 22].map((h) => hour(day + h * 3_600_000, kwh / 6));
};
const pattern = async () => (await h.admin.call("GET", "/energy/pattern")).json.pattern;

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
  w.clock.now = NOON;
  await h.admin.login();
});

describe("evening pattern", () => {
  test("says how the last evening compares with the same evening on earlier weeks", async () => {
    w.gw.statistics["sensor.kettle_plug_energy"] = { hour: [...evening(0, 11.8), ...[1, 2, 3, 4].flatMap((k) => evening(k, 10))] };
    const p = await pattern();
    expect(p).toMatchObject({ percent: 18, weekday: "Wednesday", weeks: 4, kwh: 11.8 });
    expect(p.sentence).toBe("Last evening ran 18% above your last 4 Wednesdays. Plain statistics, no guessing.");
  });
  test("below the usual says below", async () => {
    w.gw.statistics["sensor.kettle_plug_energy"] = { hour: [...evening(0, 7), ...[1, 2, 3].flatMap((k) => evening(k, 10))] };
    expect((await pattern()).sentence).toMatch(/30% below your last 3 Wednesdays/);
  });
  test("nothing to say with fewer than three earlier weeks, a small difference, or no data", async () => {
    w.gw.statistics["sensor.kettle_plug_energy"] = { hour: [...evening(0, 12), ...[1, 2].flatMap((k) => evening(k, 10))] };
    expect(await pattern()).toBeNull();
    w.gw.statistics["sensor.kettle_plug_energy"] = { hour: [...evening(0, 10.5), ...[1, 2, 3].flatMap((k) => evening(k, 10))] };
    expect(await pattern()).toBeNull();
    w.gw.statistics["sensor.kettle_plug_energy"] = { hour: [] };
    expect(await pattern()).toBeNull();
  });
});
