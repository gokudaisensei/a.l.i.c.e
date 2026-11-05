/**
 * Lifecycle of a device command (a control request sent to Home Assistant).
 *
 * Pending -> Authorized -> Dispatched -> Accepted -> Confirmed
 * Any non-terminal state may end in Failed; Dispatched/Accepted may Time out;
 * Pending/Authorized may be Cancelled.
 */
export const COMMAND_STATES = [
  "pending", // Created
  "authorized", // Permission verified
  "dispatched", // Sent to Home Assistant
  "accepted", // Home Assistant acknowledged execution
  "confirmed", // Expected state observed
  "failed", // Execution failed
  "timed_out", // Confirmation not received
  "cancelled", // Cancelled before execution
] as const;

export type CommandState = (typeof COMMAND_STATES)[number];

export const TERMINAL_STATES: readonly CommandState[] = ["confirmed", "failed", "timed_out", "cancelled"];

const TRANSITIONS: Record<CommandState, readonly CommandState[]> = {
  pending: ["authorized", "failed", "cancelled"],
  authorized: ["dispatched", "failed", "cancelled"],
  dispatched: ["accepted", "failed", "timed_out"],
  accepted: ["confirmed", "failed", "timed_out"],
  confirmed: [],
  failed: [],
  timed_out: [],
  cancelled: [],
};

export const isTerminal = (s: CommandState) => TERMINAL_STATES.includes(s);

export const canTransition = (from: CommandState, to: CommandState) => TRANSITIONS[from].includes(to);

export function assertTransition(from: CommandState, to: CommandState): void {
  if (!canTransition(from, to)) throw new Error(`Invalid command transition: ${from} -> ${to}`);
}
