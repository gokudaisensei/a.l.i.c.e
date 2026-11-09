import { Elysia, t } from "elysia";
import { requireMember, requirePermission } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

export const householdModesController = ({ auth, households, modes, modeMirror, insights }: Services) =>
  new Elysia({ name: "module.household-modes", prefix: "/household/mode", tags: ["household-modes"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => {
      const { membership } = requireMember(ctx);
      const can = membership.role !== "guest";
      return { ...modes.get(membership.householdId), mirror: modeMirror.status(membership.householdId), suggestion: can ? (insights.list(membership.householdId)[0] ?? null) : null };
    }, { detail: { summary: "Current household mode, whether Home Assistant is following it, and a suggestion if there is one" } })
    .put("/", (ctx) => {
      const { membership, session } = requirePermission(ctx, "mode.change");
      return modes.set(membership.householdId, session.userId, ctx.body.mode);
    }, { body: t.Object({ mode: t.String() }), detail: { summary: "Change the household mode: home, away, night or vacation" } });
