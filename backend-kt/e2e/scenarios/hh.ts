// HH cards — see cards/hh.md for the reviewed steps and coverage.
import type { CardDef, ScenarioContext } from "../lib/scenario.ts";
import { Actor } from "../lib/actor.ts";

function actor(ctx: ScenarioContext, name: "admin" | "member" | "guest"): Actor {
  const a = ctx.world.actors[name];
  if (!a) throw new Error(`world has no ${name}; the card needs world "household"`);
  return a;
}

function code(body: unknown): unknown {
  return (body as { error?: { code?: unknown } } | null)?.error?.code;
}

function keys(body: unknown): string[] {
  return body && typeof body === "object" ? Object.keys(body as object).sort() : [];
}

function membersOf(body: unknown): { id: string; userId: string; role: string; me?: boolean; expiresAt?: number | null }[] {
  return ((body as { members?: any[] } | null)?.members ?? []) as any[];
}

function sorted(list: unknown): string[] {
  return Array.isArray(list) ? [...(list as string[])].sort() : [];
}

export const hhCards: CardDef[] = [
  {
    id: "E2E-HH-01",
    area: "HH",
    title: "The household summary is the same for every role",
    capability: "GET /household (API.md)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = await actor(ctx, "admin").call("household.admin", "GET", "/api/v1/household");
      const member = await actor(ctx, "member").call("household.member", "GET", "/api/v1/household");
      const guest = await actor(ctx, "guest").call("household.guest", "GET", "/api/v1/household");
      ctx.expectStatus("household.admin", admin, 200);
      ctx.expectStatus("household.member", member, 200);
      ctx.expectStatus("household.guest", guest, 200);
      ctx.add("the summary has the documented keys", keys(admin.body).join(",") === "id,mode,name,role,timezone", "id,mode,name,role,timezone", keys(admin.body).join(","));
      const a = admin.body as any;
      const m = member.body as any;
      const g = guest.body as any;
      ctx.add("all roles see the same household", a?.id === m?.id && m?.id === g?.id, "same id", `${a?.id}/${m?.id}/${g?.id}`);
      ctx.add("the admin role is reported", a?.role === "admin", "admin", a?.role);
      ctx.add("the member role is reported", m?.role === "member", "member", m?.role);
      ctx.add("the guest role is reported", g?.role === "guest", "guest", g?.role);
      const anonymous = await ctx.call("household.anonymous", "GET", "/api/v1/household");
      ctx.expectStatus("household.anonymous", anonymous, 401);
      ctx.add("an anonymous caller is refused", code(anonymous.body) === "unauthenticated", "unauthenticated", code(anonymous.body));
    },
  },
  {
    id: "E2E-HH-02",
    area: "HH",
    title: "Household name/timezone update returns the documented shape",
    capability: "PATCH /household (API.md)",
    oracles: ["TS", "SPEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const patch = await admin.call("household.patch", "PATCH", "/api/v1/household", { body: { name: "Parity Home", timezone: "Europe/Berlin" } });
      ctx.expectStatus("household.patch", patch, 200);
      ctx.add("PATCH returns exactly id, name and timezone", keys(patch.body).join(",") === "id,name,timezone", "id,name,timezone", keys(patch.body).join(","));
      ctx.add("PATCH echoes the name", (patch.body as any)?.name === "Parity Home", "Parity Home", (patch.body as any)?.name);
      ctx.add("PATCH echoes the timezone", (patch.body as any)?.timezone === "Europe/Berlin", "Europe/Berlin", (patch.body as any)?.timezone);
      const get = await admin.call("household.get", "GET", "/api/v1/household");
      ctx.add("GET reflects the new name", (get.body as any)?.name === "Parity Home", "Parity Home", (get.body as any)?.name);
      ctx.add("GET reflects the new timezone", (get.body as any)?.timezone === "Europe/Berlin", "Europe/Berlin", (get.body as any)?.timezone);
      ctx.add("GET still reports the mode", typeof (get.body as any)?.mode === "string", "string", typeof (get.body as any)?.mode);
      const empty = await admin.call("household.patch.empty", "PATCH", "/api/v1/household", { body: {} });
      ctx.expectStatus("household.patch.empty", empty, 200);
      const badTz = await admin.call("household.patch.bad-timezone", "PATCH", "/api/v1/household", { body: { timezone: "Mars/Olympus" } });
      // The oracle does not check the IANA zone: it stores the string. Kotlin rejects it, which is a
      // difference the differential suite records (a stricter Kotlin is still a contract difference).
      ctx.expectStatus("household.patch.bad-timezone", badTz, 200);
      ctx.add("the oracle stores any timezone string", (badTz.body as any)?.timezone === "Mars/Olympus", "Mars/Olympus", (badTz.body as any)?.timezone);
      const longName = await admin.call("household.patch.long-name", "PATCH", "/api/v1/household", { body: { name: "x".repeat(81) } });
      ctx.expectStatus("household.patch.long-name", longName, [400, 422]);
      ctx.add("an over-long name is a validation error", code(longName.body) === "validation_error", "validation_error", code(longName.body));
    },
  },
  {
    id: "E2E-HH-03",
    area: "HH",
    title: "Members list shows role, join time and who is me",
    capability: "GET /household/members (API.md)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const list = await admin.call("household.members.admin", "GET", "/api/v1/household/members");
      ctx.expectStatus("household.members.admin", list, 200);
      const members = membersOf(list.body);
      ctx.add("there are three members", members.length === 3, 3, members.length);
      const mine = members.filter((m) => m.me);
      ctx.add("exactly one member is me", mine.length === 1, 1, mine.length);
      ctx.add("the admin is me", mine[0]?.role === "admin", "admin", mine[0]?.role);
      const roles = members.map((m) => m.role).sort().join(",");
      ctx.add("all three roles are present", roles === "admin,guest,member", "admin,guest,member", roles);
      const guest = members.find((m) => m.role === "guest");
      ctx.add("the guest has an expiry", typeof guest?.expiresAt === "number" && (guest.expiresAt as number) > Date.now(), "future timestamp", guest?.expiresAt ?? "absent");
      ctx.add("joinedAt is a number", members.every((m) => typeof (m as any).joinedAt === "number"), "number", "checked");
      const memberList = await actor(ctx, "member").call("household.members.member", "GET", "/api/v1/household/members");
      const m = membersOf(memberList.body).filter((x) => x.me);
      ctx.add("the member sees themselves as me", m.length === 1 && m[0]?.role === "member", "member/me", m[0]?.role ?? "none");
      const guestList = await actor(ctx, "guest").call("household.members.guest", "GET", "/api/v1/household/members");
      ctx.expectStatus("household.members.guest", guestList, 403);
      ctx.add("a guest cannot list members", code(guestList.body) === "forbidden", "forbidden", code(guestList.body));
      const anonymous = await ctx.call("household.members.anonymous", "GET", "/api/v1/household/members");
      ctx.expectStatus("household.members.anonymous", anonymous, 401);
    },
  },
  {
    id: "E2E-HH-04",
    area: "HH",
    title: "Role changes honour the last-admin rule",
    capability: "Member role management (FEATURES §People)",
    oracles: ["TS", "SPEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const list = await admin.call("household.members.list", "GET", "/api/v1/household/members");
      const all = membersOf(list.body);
      const target = all.find((m) => m.role === "member");
      const me = all.find((m) => m.me);
      ctx.add("the member row was found", !!target, "a member", target?.id ?? "none");
      if (!target || !me) return;
      const demote = await admin.call("household.members.demote", "PATCH", `/api/v1/household/members/${target.id}`, { body: { role: "guest" } });
      ctx.expectStatus("household.members.demote", demote, 200);
      ctx.add("the response has id, role and expiresAt", keys(demote.body).join(",") === "expiresAt,id,role", "expiresAt,id,role", keys(demote.body).join(","));
      ctx.add("the demoted role is guest", (demote.body as any)?.role === "guest", "guest", (demote.body as any)?.role);
      const perms = await member.call("permissions.me.guest", "GET", "/api/v1/permissions/me");
      ctx.add("the demoted person is a guest", (perms.body as any)?.role === "guest", "guest", (perms.body as any)?.role);
      const promote = await admin.call("household.members.promote", "PATCH", `/api/v1/household/members/${target.id}`, { body: { role: "member" } });
      ctx.expectStatus("household.members.promote", promote, 200);
      const permsBack = await member.call("permissions.me.member", "GET", "/api/v1/permissions/me");
      ctx.add("the promoted person is a member", (permsBack.body as any)?.role === "member", "member", (permsBack.body as any)?.role);
      const lastAdmin = await admin.call("household.members.demote-self", "PATCH", `/api/v1/household/members/${me.id}`, { body: { role: "member" } });
      ctx.expectStatus("household.members.demote-self", lastAdmin, 409);
      ctx.add("the last admin cannot be demoted", code(lastAdmin.body) === "conflict", "conflict", code(lastAdmin.body));
      const expiry = Date.now() + 3_600_000;
      const setExpiry = await admin.call("household.members.set-expiry", "PATCH", `/api/v1/household/members/${target.id}`, { body: { expiresAt: expiry } });
      ctx.expectStatus("household.members.set-expiry", setExpiry, 200);
      ctx.add("the expiry is echoed", typeof (setExpiry.body as any)?.expiresAt === "number", "number", (setExpiry.body as any)?.expiresAt);
      const clearExpiry = await admin.call("household.members.clear-expiry", "PATCH", `/api/v1/household/members/${target.id}`, { body: { expiresAt: null } });
      ctx.expectStatus("household.members.clear-expiry", clearExpiry, 200);
      ctx.add("a null expiry clears it", (clearExpiry.body as any)?.expiresAt === null, null, (clearExpiry.body as any)?.expiresAt);
      const badRole = await admin.call("household.members.bad-role", "PATCH", `/api/v1/household/members/${target.id}`, { body: { role: "owner" } });
      ctx.expectStatus("household.members.bad-role", badRole, [400, 422]);
      ctx.add("an unknown role is a validation error", code(badRole.body) === "validation_error", "validation_error", code(badRole.body));
    },
  },
  {
    id: "E2E-HH-05",
    area: "HH",
    title: "Removing a member ends their home access",
    capability: "Member removal (plan §4.3)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = actor(ctx, "member");
      const list = await admin.call("household.members.list", "GET", "/api/v1/household/members");
      const all = membersOf(list.body);
      const target = all.find((m) => m.role === "member");
      const me = all.find((m) => m.me);
      if (!target || !me) throw new Error("member or admin row missing");
      const removed = await admin.call("household.members.remove", "DELETE", `/api/v1/household/members/${target.id}`);
      ctx.expectStatus("household.members.remove", removed, 200);
      const household = await member.call("household.after-removal", "GET", "/api/v1/household");
      ctx.expectStatus("household.after-removal", household, 403);
      ctx.add("the removed member loses home access", code(household.body) === "access_expired", "access_expired", code(household.body));
      const session = await member.call("auth.session.after-removal", "GET", "/api/v1/auth/session");
      ctx.expectStatus("auth.session.after-removal", session, 200);
      ctx.add("the session no longer names a household", (session.body as any)?.household === null, null, (session.body as any)?.household);
      const after = await admin.call("household.members.after", "GET", "/api/v1/household/members");
      ctx.add("the member list no longer contains them", !membersOf(after.body).some((m) => m.id === target.id), "absent", "present");
      const lastAdmin = await admin.call("household.members.remove-self", "DELETE", `/api/v1/household/members/${me.id}`);
      ctx.expectStatus("household.members.remove-self", lastAdmin, 409);
      ctx.add("the last admin cannot be removed", code(lastAdmin.body) === "conflict", "conflict", code(lastAdmin.body));
    },
  },
  {
    id: "E2E-HH-06",
    area: "HH",
    title: "Invitation creation shows the code once with role and guest window",
    capability: "POST /household/invitations (API.md)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const member = await admin.createInvitation({ role: "member", expiresInHours: 24 });
      ctx.expectStatus("household.invitations.create.member", member, 200);
      const m = member.body as any;
      ctx.add("the TS shape nests the invitation", !!m?.invitation, "invitation object", typeof m?.invitation);
      ctx.add("the invitation role is member", m?.invitation?.role === "member", "member", m?.invitation?.role);
      ctx.add("the invitation carries an expiry", typeof m?.invitation?.expiresAt === "number", "number", typeof m?.invitation?.expiresAt);
      ctx.add("a member invitation has no guest window", m?.invitation?.guestAccessMs === null, null, m?.invitation?.guestAccessMs);
      ctx.add("the code is shown once", typeof m?.code === "string" && m.code.length > 0, "non-empty string", typeof m?.code);
      const guest = await admin.createInvitation({ role: "guest", guestAccessHours: 48 });
      const g = guest.body as any;
      ctx.add("the guest window is in milliseconds", g?.invitation?.guestAccessMs === 48 * 3_600_000, 48 * 3_600_000, g?.invitation?.guestAccessMs);
      const list = await admin.call("household.invitations.list", "GET", "/api/v1/household/invitations");
      const raw = JSON.stringify(list.body);
      ctx.add("the list never repeats a plain code", !raw.includes(String(m?.code ?? "\u0000")) && !raw.includes(String(g?.code ?? "\u0001")), "no code", "checked");
      const badRole = await admin.createInvitation({ role: "owner" as never });
      ctx.expectStatus("household.invitations.bad-role", badRole, 422);
      ctx.add("an unknown role is a validation error", code(badRole.body) === "validation_error", "validation_error", code(badRole.body));
      const badHours = await admin.createInvitation({ role: "member", expiresInHours: 0 });
      ctx.expectStatus("household.invitations.bad-hours", badHours, 422);
    },
  },
  {
    id: "E2E-HH-07",
    area: "HH",
    title: "Invitation list exposes the fields the UI needs",
    capability: "GET /household/invitations (API.md)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const created = await admin.createInvitation({ role: "member" });
      const guestCreated = await admin.createInvitation({ role: "guest", guestAccessHours: 24 });
      const list = await admin.call("household.invitations.list", "GET", "/api/v1/household/invitations");
      ctx.expectStatus("household.invitations.list", list, 200);
      const entries = ((list.body as any)?.invitations ?? []) as any[];
      // TS nests the created invitation, Kotlin returns it flat; find by id either way so the
      // "listed" assertion is about membership, and the shape assertions stay separate.
      const createdId = (created.body as any)?.invitation?.id ?? (created.body as any)?.id;
      const guestCreatedId = (guestCreated.body as any)?.invitation?.id ?? (guestCreated.body as any)?.id;
      const mine = entries.find((e) => e.id === createdId);
      const guest = entries.find((e) => e.id === guestCreatedId);
      ctx.add("both invitations are listed", entries.length === 2, 2, entries.length);
      ctx.add("an invitation has id, role, expiresAt and createdAt", !!mine && ["id", "role", "expiresAt", "createdAt"].every((k) => k in mine), "required keys", mine ? keys(mine).join(",") : "missing");
      ctx.add("the guest invitation keeps its access window", typeof guest?.guestAccessMs === "number", "number", typeof guest?.guestAccessMs);
      ctx.add("code and codeHash never appear", entries.every((e) => !("code" in e) && !("codeHash" in e)), "absent", "checked");
      const guestList = await actor(ctx, "guest").call("household.invitations.guest", "GET", "/api/v1/household/invitations");
      ctx.expectStatus("household.invitations.guest", guestList, 403);
    },
  },
  {
    id: "E2E-HH-08",
    area: "HH",
    title: "A revoked invitation disappears and cannot be reused",
    capability: "Invitation revoke (plan §4.3)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const created = await admin.createInvitation({ role: "member" });
      const id = (created.body as any)?.invitation?.id ?? (created.body as any)?.id;
      const inviteCode = (created.body as any)?.code as string;
      ctx.add("the invitation id is present", typeof id === "string", true, typeof id);
      if (!id || !inviteCode) return;
      const revoke = await admin.call("household.invitations.revoke", "DELETE", `/api/v1/household/invitations/${id}`);
      ctx.expectStatus("household.invitations.revoke", revoke, 200);
      const list = await admin.call("household.invitations.after", "GET", "/api/v1/household/invitations");
      ctx.add("the revoked invitation is gone", !(((list.body as any)?.invitations ?? []) as any[]).some((e) => e.id === id), "absent", "present");
      const attempted = new Actor(ctx.side, ctx.unique("Revoked Code"));
      const refused = await attempted.beginRegistration({ inviteCode });
      ctx.expectStatus("auth.register.options.revoked", refused, 400);
      ctx.add("a revoked code is refused", code(refused.body) === "invalid_invitation", "invalid_invitation", code(refused.body));
      const again = await admin.call("household.invitations.revoke-again", "DELETE", `/api/v1/household/invitations/${id}`);
      // The oracle revokes idempotently (it re-stamps revokedAt and answers ok). Kotlin throws
      // not_found on the second call, which the differential suite records as a difference.
      ctx.expectStatus("household.invitations.revoke-again", again, 200);
      ctx.add("the oracle accepts a second revoke", (again.body as any)?.ok === true, true, (again.body as any)?.ok);
    },
  },
  {
    id: "E2E-HH-09",
    area: "HH",
    title: "Profile update returns the documented fields",
    capability: "GET/PATCH /users/me (API.md)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const before = await member.call("users.me", "GET", "/api/v1/users/me");
      ctx.expectStatus("users.me", before, 200);
      ctx.add("the profile has role on GET", keys(before.body).join(",") === "avatarColor,displayName,id,locale,role", "avatarColor,displayName,id,locale,role", keys(before.body).join(","));
      const patch = await member.call("users.me.patch", "PATCH", "/api/v1/users/me", { body: { displayName: "Parity Member Two", avatarColor: 7, locale: "de-DE" } });
      ctx.expectStatus("users.me.patch", patch, 200);
      ctx.add("PATCH omits role", keys(patch.body).join(",") === "avatarColor,displayName,id,locale", "avatarColor,displayName,id,locale", keys(patch.body).join(","));
      ctx.add("PATCH echoes the display name", (patch.body as any)?.displayName === "Parity Member Two", "Parity Member Two", (patch.body as any)?.displayName);
      ctx.add("PATCH echoes the avatar colour", (patch.body as any)?.avatarColor === 7, 7, (patch.body as any)?.avatarColor);
      ctx.add("PATCH echoes the locale", (patch.body as any)?.locale === "de-DE", "de-DE", (patch.body as any)?.locale);
      const after = await member.call("users.me.after", "GET", "/api/v1/users/me");
      ctx.add("GET reflects the new values", (after.body as any)?.displayName === "Parity Member Two" && (after.body as any)?.role === "member", "name+role", `${(after.body as any)?.displayName}/${(after.body as any)?.role}`);
      const badColour = await member.call("users.me.bad-colour", "PATCH", "/api/v1/users/me", { body: { avatarColor: 13 } });
      ctx.expectStatus("users.me.bad-colour", badColour, 422);
      ctx.add("an out-of-range colour is a validation error", code(badColour.body) === "validation_error", "validation_error", code(badColour.body));
      const emptyName = await member.call("users.me.empty-name", "PATCH", "/api/v1/users/me", { body: { displayName: "" } });
      ctx.expectStatus("users.me.empty-name", emptyName, 400);
      ctx.add("an empty name is a validation error", code(emptyName.body) === "validation_error", "validation_error", code(emptyName.body));
    },
  },
  {
    id: "E2E-HH-10",
    area: "HH",
    title: "Preferences default and round-trip",
    capability: "Quiet hours and push toggle (FEATURES §People)",
    oracles: ["TS"],
    world: "household",
    run: async (ctx) => {
      const member = actor(ctx, "member");
      const before = await member.call("users.preferences", "GET", "/api/v1/users/me/preferences");
      ctx.expectStatus("users.preferences", before, 200);
      ctx.add("push is on by default", (before.body as any)?.pushEnabled === true, true, (before.body as any)?.pushEnabled);
      ctx.add("quiet hours are off by default", (before.body as any)?.quietHours === null, null, (before.body as any)?.quietHours);
      ctx.add("the default carries the user id", typeof (before.body as any)?.userId === "string", "string", typeof (before.body as any)?.userId);
      const quietHours = { enabled: true, from: "22:00", to: "07:00" };
      const patch = await member.call("users.preferences.patch", "PATCH", "/api/v1/users/me/preferences", { body: { quietHours, pushEnabled: false, extra: { theme: "dark" } } });
      ctx.expectStatus("users.preferences.patch", patch, 200);
      ctx.add("PATCH echoes quiet hours", JSON.stringify((patch.body as any)?.quietHours) === JSON.stringify(quietHours), quietHours, (patch.body as any)?.quietHours);
      ctx.add("PATCH turns push off", (patch.body as any)?.pushEnabled === false, false, (patch.body as any)?.pushEnabled);
      const after = await member.call("users.preferences.after", "GET", "/api/v1/users/me/preferences");
      ctx.add("GET keeps the quiet hours", JSON.stringify((after.body as any)?.quietHours) === JSON.stringify(quietHours), quietHours, (after.body as any)?.quietHours);
      ctx.add("GET keeps the push toggle", (after.body as any)?.pushEnabled === false, false, (after.body as any)?.pushEnabled);
      ctx.add("GET keeps the extra object", (after.body as any)?.extra?.theme === "dark", "dark", (after.body as any)?.extra?.theme);
      const cleared = await member.call("users.preferences.clear", "PATCH", "/api/v1/users/me/preferences", { body: { quietHours: null } });
      ctx.expectStatus("users.preferences.clear", cleared, 200);
      ctx.add("an explicit null clears quiet hours", (cleared.body as any)?.quietHours === null, null, (cleared.body as any)?.quietHours);
      const bad = await member.call("users.preferences.bad", "PATCH", "/api/v1/users/me/preferences", { body: { pushEnabled: "yes" } });
      ctx.expectStatus("users.preferences.bad", bad, 422);
      ctx.add("a wrong type is a validation error", code(bad.body) === "validation_error", "validation_error", code(bad.body));
    },
  },
  {
    id: "E2E-HH-11",
    area: "HH",
    title: "Permissions and sensitive-operation rules",
    capability: "GET /permissions/me, /permissions/policies, /admin/security/sensitive-operations (API.md)",
    oracles: ["TS", "SEC"],
    world: "household",
    run: async (ctx) => {
      const admin = actor(ctx, "admin");
      const me = await admin.call("permissions.me.admin", "GET", "/api/v1/permissions/me");
      ctx.expectStatus("permissions.me.admin", me, 200);
      ctx.add("the admin has members.manage", sorted((me.body as any)?.permissions).includes("members.manage"), true, "members.manage");
      const member = await actor(ctx, "member").call("permissions.me.member", "GET", "/api/v1/permissions/me");
      ctx.add("a member has members.view but not members.manage", sorted((member.body as any)?.permissions).includes("members.view") && !sorted((member.body as any)?.permissions).includes("members.manage"), "view only", sorted((member.body as any)?.permissions).join(","));
      const guest = await actor(ctx, "guest").call("permissions.me.guest", "GET", "/api/v1/permissions/me");
      ctx.add("a guest has the three guest permissions", sorted((guest.body as any)?.permissions).join(",") === "device.control,device.view,scene.run", "device.control,device.view,scene.run", sorted((guest.body as any)?.permissions).join(","));
      const rules = await admin.call("security.rules", "GET", "/api/v1/admin/security/sensitive-operations");
      ctx.expectStatus("security.rules", rules, 200);
      const list = ((rules.body as any)?.rules ?? []) as any[];
      ctx.add("sensitive rules have a domain, action and flag", list.length > 0 && list.every((r) => typeof r.domain === "string" && typeof r.action === "string" && typeof r.sensitive === "boolean"), "rule shape", list.length);
      const put = await admin.call("security.rules.put", "PUT", "/api/v1/admin/security/sensitive-operations", { body: { rules: [{ domain: "lock", action: "unlock", sensitive: true }] } });
      ctx.expectStatus("security.rules.put", put, 200);
      ctx.add("the replacement returns rules", Array.isArray((put.body as any)?.rules), "array", typeof (put.body as any)?.rules);
      const after = await admin.call("security.rules.after", "GET", "/api/v1/admin/security/sensitive-operations");
      ctx.add("the custom rule is effective", (((after.body as any)?.rules ?? []) as any[]).some((r) => r.domain === "lock" && r.action === "unlock" && r.sensitive === true), "lock.unlock sensitive", "checked");
      const memberPut = await actor(ctx, "member").call("security.rules.member", "PUT", "/api/v1/admin/security/sensitive-operations", { body: { rules: [] } });
      ctx.expectStatus("security.rules.member", memberPut, 403);
      ctx.add("a member cannot change security rules", code(memberPut.body) === "forbidden", "forbidden", code(memberPut.body));
      const guestGet = await actor(ctx, "guest").call("security.rules.guest", "GET", "/api/v1/admin/security/sensitive-operations");
      ctx.expectStatus("security.rules.guest", guestGet, 403);
      const bad = await admin.call("security.rules.bad", "PUT", "/api/v1/admin/security/sensitive-operations", { body: { rules: [{ domain: 1 }] } });
      ctx.expectStatus("security.rules.bad", bad, [400, 422]);
      ctx.add("a malformed rule is a validation error", code(bad.body) === "validation_error", "validation_error", code(bad.body));
    },
  },
  {
    id: "E2E-HH-12",
    area: "HH",
    title: "Person to member linking",
    capability: "GET/PUT /household/people (plan §4.3)",
    oracles: ["TS", "HA"],
    blocked: "Linking validates against Home Assistant person.* entities; the M2 stacks have no HA connection, so there is no person to link to. Runs in M3 with the seeded parity persons.",
  },
  {
    id: "E2E-HH-13",
    area: "HH",
    title: "Presence from an outside HA person change",
    capability: "Presence derived from HA (plan §4.3)",
    oracles: ["HA", "TS"],
    blocked: "Needs the backend connected to HA-A and a state change made directly in HA; the M2 capability suite does not attach HA (M3).",
  },
  {
    id: "E2E-HH-14",
    area: "HH",
    title: "Guest device visibility and device policies",
    capability: "Device policies and guest visibility (plan §4.3, §4.5)",
    oracles: ["SEC", "TS"],
    blocked: "Allow/deny policies act on synced Things; without an HA connection and the seeded entities (M3/M4) there is no device to hide.",
  },
];
