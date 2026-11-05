import { Elysia, t } from "elysia";
import { requirePermission, type RequestAuth } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Caller } from "../devices/devices.service";
import type { Services } from "@/services";

const caller = (a: RequestAuth): Caller => {
  const { session, membership } = requirePermission(a, "activity.view");
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp };
};

const kinds = t.Union(["device", "lock", "scene", "routine", "mode", "automation", "alert", "presence"].map((k) => t.Literal(k)));

export const activityController = ({ auth, households, activity }: Services) =>
  new Elysia({ name: "module.activity", prefix: "/activity", tags: ["activity"] })
    .use(sessionPlugin(auth, households))
    .get("/", (ctx) => activity.list(caller(ctx), ctx.query), {
      query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), before: t.Optional(t.String()), kind: t.Optional(kinds) }),
      detail: { summary: "What has happened in the home, newest first, with how many entries are new since you last looked" },
    })
    .post("/seen", (ctx) => { activity.markSeen(caller(ctx)); return { ok: true }; }, { detail: { summary: "I have looked: clears the new count" } });
