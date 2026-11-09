/** The one place the app talks to the Alice backend: an Eden Treaty client typed from the backend's own routes.
 *  Requests go to `/api/v1/*` on this origin (proxied; see next.config.ts), so the session cookie is first-party.
 *  `v1.devices({ id }).commands.post(body)` is checked against the backend: a renamed route or a changed body or response is a compile error here. */
import { treaty } from "@elysiajs/eden";
import type { App } from "alice-backend/app";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const origin = typeof location === "undefined" ? "http://localhost" : location.origin;

export const client = treaty<App>(origin, {
  // X-Requested-With tells the backend this call comes from the app itself, not a form on another site.
  headers: { "x-requested-with": "alice" },
});
export const v1 = client.api.v1;

type Result = { data: unknown; error: unknown; status: number };

/** Waits for a treaty call, returns its (typed) data, and turns every failure into an ApiError carrying the backend's code and message. */
export async function ok<R extends Result>(call: Promise<R>): Promise<NonNullable<Extract<R, { error: null }>["data"]>> {
  let res: R;
  try {
    res = await call;
  } catch {
    throw new ApiError(0, "offline", "Can't reach Alice. Check that the backend is running.");
  }
  if (res.error) {
    const body = (res.error as { value?: { error?: { code?: string; message?: string } } }).value;
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? `Something went wrong (${res.status})`);
  }
  return res.data as NonNullable<Extract<R, { error: null }>["data"]>;
}
