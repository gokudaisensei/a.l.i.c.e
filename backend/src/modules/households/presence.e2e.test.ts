import { beforeEach, describe, expect, test } from "bun:test";
import { FakeSocket } from "../../testing/fake-socket";
import type { Browser } from "../../testing/http";
import { changeState, createWorld, homeWithHa, type World } from "../../testing/world";
import { state } from "../home-assistant/testing";

let w: World;
let h: Awaited<ReturnType<typeof homeWithHa>>;
let n = 0;
const people = async (b: Browser = h.admin) => (await b.call("GET", "/household/people")).json;
const link = (userId: string, personEntityId: string | null) => h.admin.call("PUT", `/household/people/${userId}`, { personEntityId });
const idOf = async (b: Browser) => (await b.call("GET", "/users/me")).json.id as string;
function attach(b: Browser) {
  const session = w.services.auth.getSession(b.cookie.split("=")[1]!)!;
  const s = new FakeSocket(`s${++n}`);
  w.services.realtime.connect(s, session, w.services.households.getMembership(session.userId)!);
  w.services.realtime.receive(s.id, JSON.stringify({ type: "subscribe", resource: "household" }));
  return s;
}

beforeEach(async () => {
  w = createWorld();
  h = await homeWithHa(w);
});

describe("linking Home Assistant people to household members", () => {
  test("members are listed with a suggested person when the names match; nothing is linked until an admin says so", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const r = await people();
    expect(r.people.map((p: any) => [p.displayName, p.personEntityId, p.home, p.suggestedPersonEntityId])).toEqual([
      ["Gokul", null, null, "person.gokul"], ["Meera", null, null, "person.meera"],
    ]);
    expect(r.unlinkedPersons.map((p: any) => p.entityId).sort()).toEqual(["person.gokul", "person.meera"]);
    expect((await people(meera)).people).toHaveLength(2); // members may see who is home
  });

  test("linking shows who is home and updates as people come and go", async () => {
    const meera = await h.join("Meera", { role: "member" });
    expect((await link(await idOf(h.admin), "person.gokul")).status).toBe(200);
    await link(await idOf(meera), "person.meera");
    changeState(w.gw, "person.meera", "not_home");
    const r = await people();
    expect(r.people.map((p: any) => [p.displayName, p.personEntityId, p.home, p.suggestedPersonEntityId])).toEqual([["Gokul", "person.gokul", true, null], ["Meera", "person.meera", false, null]]);
    expect(r.unlinkedPersons).toEqual([]);
  });

  test("a person belongs to one member; links can be changed and removed; unknown people and non-members are refused", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const [gokul, meeraId] = [await idOf(h.admin), await idOf(meera)];
    await link(gokul, "person.gokul");
    expect((await link(meeraId, "person.gokul")).json.error.code).toBe("conflict");
    expect((await link(meeraId, "person.nobody")).json.error.code).toBe("unknown_entity");
    expect((await link("usr_stranger", "person.meera")).status).toBe(404);
    expect((await link(gokul, "person.meera")).status).toBe(200); // moved
    expect((await link(gokul, null)).status).toBe(200);
    expect((await people()).people[0].personEntityId).toBeNull();
  });

  test("only admins can link, and linking needs a fresh passkey; guests cannot see who is home", async () => {
    const meera = await h.join("Meera", { role: "member" });
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect((await meera.call("PUT", `/household/people/${await idOf(meera)}`, { personEntityId: "person.meera" })).status).toBe(403);
    expect((await lakshmi.call("GET", "/household/people")).status).toBe(403);
    w.clock.now += 6 * 60_000;
    expect((await link(await idOf(h.admin), "person.gokul")).json.error.code).toBe("step_up_required");
  });

  test("once anyone is linked, only linked non-guest members count for 'everyone has left'", async () => {
    const lakshmi = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    expect(w.services.presence.counts(w.services.households.getMembership(await idOf(h.admin))!.householdId)).toEqual({ total: 2, home: 2 }); // nothing linked: every person
    const hh = w.services.households.getMembership(await idOf(h.admin))!.householdId;
    await link(await idOf(h.admin), "person.gokul");
    expect(w.services.presence.counts(hh)).toEqual({ total: 1, home: 1 }); // Meera's person is not a linked member, so it does not count
    w.gw.states = [...w.gw.states, state("person.lakshmi", "home", { friendly_name: "Lakshmi" })];
    await h.admin.call("POST", "/ha/connection/resync");
    await link(await idOf(lakshmi), "person.lakshmi");
    expect(w.services.presence.counts(hh)).toEqual({ total: 1, home: 1 }); // a guest is linked but does not count
    changeState(w.gw, "person.gokul", "not_home");
    expect(w.services.presence.counts(hh)).toEqual({ total: 1, home: 0 }); // so everyone (who counts) has left even though the guest is home
  });

  test("arrivals and departures are pushed to members and admins, not guests", async () => {
    const meeraB = await h.join("Meera", { role: "member" });
    const lakshmiB = await h.join("Lakshmi", { role: "guest", guestAccessHours: 24 });
    await link(await idOf(meeraB), "person.meera");
    const admin = attach(h.admin); const guest = attach(lakshmiB);
    changeState(w.gw, "person.meera", "not_home");
    changeState(w.gw, "person.gokul", "not_home"); // not linked to anyone
    changeState(w.gw, "person.meera", "home");
    expect(admin.of("presence.changed").map((m: any) => m.data)).toEqual([
      { userId: await idOf(meeraB), personEntityId: "person.meera", home: false },
      { userId: null, personEntityId: "person.gokul", home: false },
      { userId: await idOf(meeraB), personEntityId: "person.meera", home: true },
    ]);
    expect(guest.of("presence.changed")).toHaveLength(0);
    changeState(w.gw, "person.meera", "home"); // no change
    expect(admin.of("presence.changed")).toHaveLength(3);
  });
});
