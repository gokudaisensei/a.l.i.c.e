import { Elysia, t } from "elysia";
import { requireMember, requirePermission, requireStepUp } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";
import { ROLE_PERMISSIONS } from "./permissions";

export const permissionsController = ({ auth, households, permissions }: Services) =>
  new Elysia({ name: "module.permissions", prefix: "/permissions", tags: ["permissions"] })
    .use(sessionPlugin(auth, households))
    .get("/me", (ctx) => {
      const { membership } = requireMember(ctx);
      return { role: membership.role, expiresAt: membership.expiresAt, permissions: ROLE_PERMISSIONS[membership.role] };
    })
    .get("/policies", (ctx) => ({ policies: permissions.listPolicies(requirePermission(ctx, "security.manage").membership.householdId) }))
    .post("/policies", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      requireStepUp(session);
      return permissions.createPolicy(membership.householdId, session.userId, ctx.body);
    }, {
      body: t.Object({
        connectionId: t.String(), entityId: t.String(), subjectType: t.Union([t.Literal("role"), t.Literal("member")]),
        subjectId: t.String(), effect: t.Union([t.Literal("allow"), t.Literal("deny")]), operations: t.Optional(t.Nullable(t.Array(t.String()))),
      }),
    })
    .delete("/policies/:id", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      requireStepUp(session);
      permissions.deletePolicy(membership.householdId, session.userId, ctx.params.id);
      return { ok: true };
    });

/** Admin settings for which device operations need a passkey step-up. */
export const adminSecurityController = ({ auth, households, permissions }: Services) =>
  new Elysia({ name: "module.admin-security", prefix: "/admin/security", tags: ["administration"] })
    .use(sessionPlugin(auth, households))
    .get("/sensitive-operations", (ctx) => ({ rules: permissions.effectiveSensitivity(requirePermission(ctx, "security.manage").membership.householdId) }))
    .put("/sensitive-operations", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      requireStepUp(session);
      return permissions.replaceSensitivityRules(membership.householdId, session.userId, ctx.body.rules);
    }, {
      body: t.Object({ rules: t.Array(t.Object({ domain: t.String(), action: t.String(), deviceClass: t.Optional(t.String()), sensitive: t.Boolean() })) }),
      detail: { summary: "Replace this household's rules. The response lists any default that was switched off" },
    })
    .delete("/sensitive-operations/:id", (ctx) => {
      const { membership, session } = requirePermission(ctx, "security.manage");
      requireStepUp(session);
      permissions.deleteSensitivityRule(membership.householdId, session.userId, ctx.params.id);
      return { ok: true };
    });
