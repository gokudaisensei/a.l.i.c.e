import { AppError } from "@/core/errors/errors";
import type { Membership } from "@/modules/households/household.service";
import type { SessionContext } from "@/modules/authentication/auth.service";
import { can, type Permission } from "@/modules/permissions/permissions";

export type RequestAuth = {
  session: SessionContext | null;
  membership: Membership | null;
};

export const COOKIE = "alice_session";

/** A signed-in session. Recovery sessions are refused unless a route opts in. */
export function requireSession(a: RequestAuth, opts: { allowRestricted?: boolean } = {}): SessionContext {
  if (!a.session) throw new AppError(401, "unauthenticated", "Please sign in");
  if (a.session.restricted && !opts.allowRestricted) throw new AppError(403, "restricted_session", "Add a new passkey to finish recovering your account");
  return a.session;
}

/** A signed-in session whose user currently belongs to a household. */
export function requireMember(a: RequestAuth): { session: SessionContext; membership: Membership } {
  const session = requireSession(a);
  if (!a.membership) throw new AppError(403, "access_expired", "You do not have access to a home");
  return { session, membership: a.membership };
}

export function requirePermission(a: RequestAuth, permission: Permission) {
  const ctx = requireMember(a);
  if (!can(ctx.membership.role, permission)) throw new AppError(403, "forbidden", "You do not have permission to do that");
  return ctx;
}

/** Sensitive actions need a passkey assertion from the last few minutes. */
export function requireStepUp(session: SessionContext) {
  if (!session.steppedUp) throw new AppError(403, "step_up_required", "Confirm with your passkey to continue");
}
