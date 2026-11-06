import { Elysia, t } from "elysia";
import { AppError } from "@/core/errors/errors";
import { clientIp, enforce } from "@/core/http/rate-limit";
import type { Services } from "@/services";

/** What support staff can reach. Authenticated by an operator token, never by a household session. */
export const operatorController = ({ operators, limits }: Services) =>
  new Elysia({ name: "module.operator", prefix: "/operator", tags: ["support"] })
    .derive(({ request, server, headers }) => {
      enforce(limits.auth, clientIp(request, server as never, false));
      const h = headers.authorization ?? "";
      if (!h.startsWith("Bearer ")) throw new AppError(401, "unauthenticated", "Support sign-in failed");
      return { operator: operators.authenticate(h.slice(7).trim()) };
    })
    .get("/homes", () => ({ homes: operators.homes() }), { detail: { summary: "Homes that have an open support grant, and what each allows" } })
    .get("/homes/:id/health", (ctx) => operators.health(ctx.operator, ctx.params.id), { params: t.Object({ id: t.String() }), detail: { summary: "System health, if the household allowed it" } })
    .get("/homes/:id/devices", (ctx) => operators.devicesOf(ctx.operator, ctx.params.id), { params: t.Object({ id: t.String() }), detail: { summary: "The device list (no cameras unless allowed), read only, if the household allowed it" } });
