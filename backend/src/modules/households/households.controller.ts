import { Elysia, t } from "elysia";
import { householdSettings } from "../../core/database/schema";
import { eq } from "drizzle-orm";
import { requireMember, requirePermission, requireStepUp } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import { writeAudit } from "../../core/security/audit";
import type { Services } from "../../services";

const role = t.Union([t.Literal("admin"), t.Literal("member"), t.Literal("guest")]);

export const householdsController = ({ db, auth, households, presence }: Services) =>
  new Elysia({ name: "module.households", prefix: "/household", tags: ["households"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => {
      const { membership } = requireMember(ctx);
      const h = households.get(membership.householdId);
      const settings = db.select().from(householdSettings).where(eq(householdSettings.householdId, h.id)).get();
      return { id: h.id, name: h.name, timezone: h.timezone, mode: settings?.mode ?? "home", role: membership.role };
    })
    .patch("/", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.manage");
      const h = households.update(membership.householdId, ctx.body);
      writeAudit(db, { householdId: h.id, actorId: session.userId, action: "household.updated", detail: ctx.body });
      return { id: h.id, name: h.name, timezone: h.timezone };
    }, { body: t.Object({ name: t.Optional(t.String({ minLength: 1, maxLength: 80 })), timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })) }) })
    // ---- members ----
    .get("/members", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.view");
      return { members: households.listMembers(membership.householdId).map((m) => ({ ...m, me: m.userId === session.userId })) };
    })
    .patch("/members/:id", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.manage");
      requireStepUp(session);
      const m = households.updateMember(membership.householdId, ctx.params.id, ctx.body);
      writeAudit(db, { householdId: membership.householdId, actorId: session.userId, action: "household.member_updated", resource: m.id, detail: ctx.body });
      return { id: m.id, role: m.role, expiresAt: m.expiresAt };
    }, { body: t.Object({ role: t.Optional(role), expiresAt: t.Optional(t.Nullable(t.Integer())) }) })
    .delete("/members/:id", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.manage");
      requireStepUp(session);
      households.removeMember(membership.householdId, ctx.params.id);
      writeAudit(db, { householdId: membership.householdId, actorId: session.userId, action: "household.member_removed", resource: ctx.params.id });
      return { ok: true };
    })
    // ---- who is home ----
    .get("/people", (ctx) => presence.people(requirePermission(ctx, "members.view").membership.householdId), {
      detail: { summary: "Household members with which Home Assistant person they are linked to and whether they are home" },
    })
    .put("/people/:userId", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.manage");
      requireStepUp(session);
      presence.link(membership.householdId, session.userId, ctx.params.userId, ctx.body.personEntityId);
      return presence.people(membership.householdId);
    }, { body: t.Object({ personEntityId: t.Nullable(t.String()) }), detail: { summary: "Link a member to a Home Assistant person (or null to unlink)" } })
    // ---- invitations ----
    .get("/invitations", (ctx) => ({ invitations: households.listInvitations(requirePermission(ctx, "members.manage").membership.householdId) }))
    .post("/invitations", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.manage");
      requireStepUp(session);
      const r = households.createInvitation(membership.householdId, session.userId, ctx.body);
      writeAudit(db, { householdId: membership.householdId, actorId: session.userId, action: "household.invitation_created", resource: r.invitation.id, detail: { role: ctx.body.role } });
      return { invitation: r.invitation, code: r.code }; // shown once
    }, { body: t.Object({ role, expiresInHours: t.Optional(t.Number({ minimum: 1, maximum: 24 * 14 })), guestAccessHours: t.Optional(t.Number({ minimum: 1, maximum: 24 * 90 })) }) })
    .delete("/invitations/:id", (ctx) => {
      const { membership, session } = requirePermission(ctx, "members.manage");
      households.revokeInvitation(membership.householdId, ctx.params.id);
      writeAudit(db, { householdId: membership.householdId, actorId: session.userId, action: "household.invitation_revoked", resource: ctx.params.id });
      return { ok: true };
    });
