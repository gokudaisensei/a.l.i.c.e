import type { Db } from "@/core/database/client";
import { env } from "@/core/config/env";
import { AuthService, type AuthConfig } from "@/modules/authentication/auth.service";
import { HouseholdService } from "@/modules/households/household.service";
import { UserService } from "@/modules/users/user.service";
import { PermissionService } from "@/modules/permissions/permission.service";

export interface Services {
  db: Db;
  households: HouseholdService;
  auth: AuthService;
  permissions: PermissionService;
  users: UserService;
}

export const defaultAuthConfig = (): AuthConfig => ({
  rpId: env.webauthn.rpId, rpName: env.webauthn.rpName, origin: env.webauthn.origin, sessionTtlHours: env.sessionTtlHours,
});

/** Wires the services that share one database. Tests pass an in-memory db and their own clock/config. */
export function createServices(db: Db, opts: { now?: () => number; auth?: AuthConfig } = {}): Services {
  const households = new HouseholdService(db, opts.now);
  return {
    db,
    households,
    auth: new AuthService(db, households, opts.auth ?? defaultAuthConfig(), opts.now),
    permissions: new PermissionService(db, households, opts.now),
    users: new UserService(db),
  };
}
