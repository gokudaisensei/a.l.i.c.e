import { Elysia, t } from "elysia";
import { requirePermission, type RequestAuth } from "@/core/http/guards";
import { sessionPlugin } from "@/core/http/session-plugin";
import type { Caller } from "../devices/devices.service";
import type { Services } from "@/services";

const caller = (a: RequestAuth): Caller => {
  const { session, membership } = requirePermission(a, "energy.view");
  return { householdId: membership.householdId, userId: session.userId, role: membership.role, steppedUp: session.steppedUp };
};

export const energyController = ({ auth, households, energy }: Services) =>
  new Elysia({ name: "module.energy", prefix: "/energy", tags: ["energy"] })
    .use(sessionPlugin(auth, households))
    .get("/summary", (ctx) => energy.summary(caller(ctx)), { detail: { summary: "What the home is drawing now, used today so far, and the biggest users" } })
    .get("/history", (ctx) => energy.history(caller(ctx), ctx.query), {
      query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()), resolution: t.Optional(t.Union([t.Literal("hour"), t.Literal("day")])) }),
      detail: { summary: "Energy used over time (kWh), hourly for up to 7 days or daily for up to a year" },
    })
    .get("/devices", (ctx) => energy.deviceList(caller(ctx)), { detail: { summary: "Each device with a meter: power now, energy today, and its power limit" } });
