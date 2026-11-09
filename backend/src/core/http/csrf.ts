import { AppError } from "../errors/errors";
import { COOKIE } from "./guards";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cross-site request protection for cookie sessions, on top of SameSite=Lax. A request that changes something and carries
 * the session cookie must come from one of this app's own origins. Browsers always say where a cross-site request came from
 * (the Origin header), so a forged one is refused; a request with no Origin at all (a script, not a browser) must say
 * itself with `X-Requested-With`, which a forged form cannot add. Support staff use bearer tokens, not cookies, and are unaffected.
 */
export function checkSameSite(request: Request, allowedOrigins: readonly string[]) {
  if (SAFE.has(request.method)) return;
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie.split(";").some((c) => c.trim().startsWith(`${COOKIE}=`))) return;
  const origin = request.headers.get("origin");
  if (origin) {
    if (!allowedOrigins.includes(origin)) throw new AppError(403, "csrf_blocked", "This request came from another site");
    return;
  }
  if (!request.headers.get("x-requested-with")) throw new AppError(403, "csrf_blocked", "This request did not say where it came from");
}

/** A WebSocket opened from a web page must come from one of this app's origins (otherwise another site could use your session). */
export function checkSocketOrigin(request: Request, allowedOrigins: readonly string[]) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) throw new AppError(403, "csrf_blocked", "This connection came from another site");
}
