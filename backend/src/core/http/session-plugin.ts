import { Elysia } from "elysia";
import type { AuthService } from "../../modules/authentication/auth.service";
import type { HouseholdService } from "../../modules/households/household.service";
import { env } from "../config/env";
import { COOKIE, type RequestAuth, sessionCookieOptions } from "./guards";

/** Resolves the session cookie into `{ session, membership }` for every route below it. */
export const sessionPlugin = (auth: AuthService, households: HouseholdService) =>
  new Elysia({ name: "session" }).derive({ as: "scoped" }, ({ cookie }): RequestAuth => {
    const token = cookie[COOKIE]?.value as string | undefined;
    const session = auth.getSession(token);
    // A renewed session gets a cookie that lasts as long: otherwise the browser would drop it at the old expiry.
    if (session?.renewedUntil && token) cookie[COOKIE]!.set({ value: token, ...sessionCookieOptions(session.renewedUntil, env.nodeEnv === "production") });
    return { session, membership: session ? households.getMembership(session.userId) : null };
  });
