import type { DeviceCommand, FailureCode } from "./command-types";

/** A command as clients see it: internal ids and raw Home Assistant error text are not included. */
export interface PublicCommand {
  id: string;
  entityId: string;
  action: string;
  parameters: Record<string, unknown>;
  state: DeviceCommand["state"];
  requestedState: Record<string, unknown> | null;
  actualState: Record<string, unknown> | null;
  requestedBy: string | null;
  source: DeviceCommand["source"];
  failure: { code: FailureCode; message: string } | null;
  confirmedBy: DeviceCommand["confirmedBy"];
  createdAt: number;
  dispatchedAt: number | null;
  acceptedAt: number | null;
  finishedAt: number | null;
  timeoutAt: number | null;
}

/** Messages that come from Home Assistant itself can contain URLs, entity ids or stack text, so clients get a fixed sentence. */
const MASKED: Partial<Record<FailureCode, string>> = {
  ha_rejected: "Home Assistant refused the command",
  internal: "Something went wrong",
};

export function toPublicCommand(c: DeviceCommand): PublicCommand {
  return {
    id: c.id, entityId: c.entityId, action: c.action, parameters: c.parameters, state: c.state, requestedState: c.requestedState,
    actualState: c.actualState, requestedBy: c.requestedBy, source: c.source, confirmedBy: c.confirmedBy, createdAt: c.createdAt,
    dispatchedAt: c.dispatchedAt, acceptedAt: c.acceptedAt, finishedAt: c.finishedAt, timeoutAt: c.timeoutAt,
    failure: c.failure ? { code: c.failure.code, message: MASKED[c.failure.code] ?? c.failure.message } : null,
  };
}
