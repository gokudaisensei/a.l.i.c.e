import { Elysia } from "elysia";
import { requirePermission } from "../../core/http/guards";
import { sessionPlugin } from "../../core/http/session-plugin";
import type { Services } from "../../services";

export const insightsController = ({ auth, households, insights }: Services) =>
  new Elysia({ name: "module.insights", prefix: "/insights", tags: ["insights"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => ({ insights: insights.list(requirePermission(ctx, "mode.change").membership.householdId) }), { detail: { summary: "Suggestions, e.g. switching the household mode" } })
    .post("/:id/dismiss", (ctx) => { insights.dismiss(requirePermission(ctx, "mode.change").membership.householdId, ctx.params.id); return { ok: true }; }, { detail: { summary: "Not now: hide this suggestion for a few hours" } });
