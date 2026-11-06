import type { CommandState } from "../command-lifecycle";

export type CommandSource = "user" | "automation" | "ai" | "job";

/** Who is asking, and how strongly we know it. */
export interface Actor {
  userId: string | null;
  source: CommandSource;
  /** True when the user passed a fresh passkey step-up (needed for sensitive operations like unlock). */
  steppedUp?: boolean;
}

export interface CommandInput {
  householdId: string;
  entityId: string;
  /** Application-level operation, e.g. "turn_on", "set_brightness", "unlock". */
  action: string;
  /** Application-level parameters, e.g. { brightness_pct: 30 }. */
  parameters?: Record<string, unknown>;
  actor: Actor;
  /** Set when this command puts back another one. */
  undoOf?: string;
  /** Override how long to wait for the desired state after HA accepts. */
  confirmTimeoutMs?: number;
}

export type FailureCode =
  | "unknown_entity"
  | "unsupported_operation"
  | "forbidden"
  | "step_up_required"
  | "invalid_parameters"
  | "device_unavailable"
  | "ha_rejected"
  | "ha_unreachable"
  | "not_confirmed"
  | "interrupted"
  | "internal";

export interface DeviceCommand {
  id: string;
  householdId: string;
  connectionId: string | null;
  entityId: string;
  domain: string;
  action: string;
  parameters: Record<string, unknown>;
  state: CommandState;
  /** What we expected to observe, in application-level values. Null when the operation has no observable state. */
  requestedState: Record<string, unknown> | null;
  /** The entity's application-level values when the command finished. */
  actualState: Record<string, unknown> | null;
  requestedBy: string | null;
  source: CommandSource;
  haContextId: string | null;
  failure: { code: FailureCode; message: string } | null;
  /** "state" = the desired state was observed (any cause); "already" = it was already true; "unobservable" = nothing to observe. */
  confirmedBy: "state" | "already" | "unobservable" | null;
  createdAt: number;
  dispatchedAt: number | null;
  acceptedAt: number | null;
  finishedAt: number | null;
  timeoutAt: number | null;
  /** The entity's application-level values just before the command ran. */
  previousState: Record<string, unknown> | null;
  undoOf: string | null;
  undoneBy: string | null;
}
