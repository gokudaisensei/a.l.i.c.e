import type { Actor } from "./command-types";

export interface AuthorizationRequest {
  actor: Actor;
  householdId: string;
  connectionId: string;
  entityId: string;
  domain: string;
  action: string;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
}

/** Decides whether an actor may run an operation on an entity. Real RBAC + device policies arrive with identity. */
export interface Authorizer {
  authorize(req: AuthorizationRequest): Promise<AuthorizationResult>;
}

/** Temporary stand-in until the permissions module exists. Allows everything. */
export const allowAll: Authorizer = { authorize: async () => ({ allowed: true }) };
