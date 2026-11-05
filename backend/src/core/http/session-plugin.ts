import { Elysia } from "elysia";
import type { AuthService } from "@/modules/authentication/auth.service";
import type { HouseholdService } from "@/modules/households/household.service";
import { COOKIE, type RequestAuth } from "./guards";

/** Resolves the session cookie into `{ session, membership }` for every route below it. */
export const sessionPlugin = (auth: AuthService, households: HouseholdService) =>
  new Elysia({ name: "session" }).derive({ as: "scoped" }, ({ cookie }): RequestAuth => {
    const session = auth.getSession(cookie[COOKIE]?.value as string | undefined);
    return { session, membership: session ? households.getMembership(session.userId) : null };
  });
