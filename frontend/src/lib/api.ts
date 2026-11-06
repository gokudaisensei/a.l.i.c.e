/** The one place the app talks to the Alice backend. Requests go to `/api/v1/*` on this origin (proxied; see next.config.ts). */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const BASE = "/api/v1";

export async function api<T = unknown>(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method, credentials: "same-origin",
      // X-Requested-With tells the backend this call comes from the app itself, not a form on another site.
      headers: { "x-requested-with": "alice", ...(body === undefined ? {} : { "content-type": "application/json" }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "Can't reach Alice. Check that the backend is running.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? `Something went wrong (${res.status})`);
  return json as T;
}
export const get = <T,>(p: string) => api<T>("GET", p);
export const post = <T,>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const put = <T,>(p: string, b?: unknown) => api<T>("PUT", p, b ?? {});
export const del = <T,>(p: string) => api<T>("DELETE", p);
export const patch = <T,>(p: string, b?: unknown) => api<T>("PATCH", p, b ?? {});
