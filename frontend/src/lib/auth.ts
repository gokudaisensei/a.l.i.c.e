"use client";
import { create } from "zustand";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { ApiError, get, post } from "./api";
import { S, bump } from "./store";
import { resetLoaded, stopRealtime } from "./live";
import type { Role } from "./data";

export interface Me {
  userId: string; displayName: string; role: Role | null; steppedUp: boolean; restricted: boolean; expiresAt: number;
}
export type AuthState =
  | { status: "loading" }
  | { status: "offline"; message: string }
  | { status: "setup" }
  | { status: "anon" }
  | { status: "in"; me: Me };

export const useAuth = create<{ state: AuthState }>(() => ({ state: { status: "loading" } }));
const set = (state: AuthState) => useAuth.setState({ state });

interface SessionDto { userId: string; expiresAt: number; steppedUp: boolean; restricted: boolean; household: { id: string; role: Role } | null }
interface SignedInDto { user: { id: string; displayName: string }; household: { id: string; role: Role } | null; expiresAt: number; recoveryCodes?: string[] }

const toMe = (userId: string, displayName: string, d: { household: { role: Role } | null; steppedUp?: boolean; restricted?: boolean; expiresAt: number }): Me => ({
  userId, displayName, role: d.household?.role ?? null, steppedUp: d.steppedUp ?? true, restricted: d.restricted ?? false, expiresAt: d.expiresAt,
});

function enter(me: Me) {
  if (me.role) S.role = me.role;
  set({ status: "in", me });
  bump();
}

/** Called once at start: who is signed in, or does this install still need setting up? */
export async function loadSession() {
  try {
    const s = await get<SessionDto>("/auth/session");
    const name = await get<{ displayName: string }>("/users/me").then((u) => u.displayName).catch(() => "You");
    enter(toMe(s.userId, name, s));
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      try { set((await get<{ needsSetup: boolean }>("/auth/setup")).needsSetup ? { status: "setup" } : { status: "anon" }); }
      catch (e2) { set({ status: "offline", message: (e2 as Error).message }); }
    } else set({ status: "offline", message: (e as Error).message });
  }
}

/** The browser's own words for passkey problems are unfriendly; say what happened plainly. */
export function passkeyMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const n = (e as { name?: string })?.name;
  if (n === "NotAllowedError" || n === "AbortError") return "The passkey prompt was closed or timed out. Try again.";
  if (n === "InvalidStateError") return "This device already has a passkey for Alice.";
  if (n === "SecurityError") return "Passkeys need Alice to be opened at its real address (localhost or HTTPS).";
  return (e as Error)?.message || "Something went wrong with the passkey.";
}
export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

/** Creates the first home (no invitation) or joins one (with the invitation code). Returns the one-time recovery codes. */
export async function register(displayName: string, inviteCode?: string): Promise<string[]> {
  const o = await post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/register/options", { displayName, inviteCode: inviteCode || undefined });
  const response = await startRegistration({ optionsJSON: o.options });
  const r = await post<SignedInDto>("/auth/register/verify", { challengeId: o.challengeId, response, deviceLabel: deviceLabel() });
  // Hold the codes on screen before entering the app: they are shown once.
  pendingMe = toMe(r.user.id, r.user.displayName, { household: r.household, expiresAt: r.expiresAt });
  return r.recoveryCodes ?? [];
}
let pendingMe: Me | null = null;
export function finishRegistration() { if (pendingMe) { enter(pendingMe); pendingMe = null; } }

export async function signIn() {
  const o = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/login/options");
  const response = await startAuthentication({ optionsJSON: o.options });
  const r = await post<SignedInDto>("/auth/login/verify", { challengeId: o.challengeId, response });
  enter(toMe(r.user.id, r.user.displayName, { household: r.household, expiresAt: r.expiresAt }));
}

export async function signInWithRecoveryCode(code: string) {
  const r = await post<SignedInDto & { restricted?: boolean }>("/auth/recovery/verify", { code });
  enter(toMe(r.user.id, r.user.displayName, { household: r.household, restricted: true, expiresAt: r.expiresAt }));
}

export async function signOut() {
  await post("/auth/logout").catch(() => {});
  stopRealtime();
  resetLoaded();
  set({ status: "anon" });
}

/** A fresh passkey check for sensitive actions (unlock, change settings). Resolves when the session is stepped up. */
export async function stepUp() {
  const o = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/step-up/options");
  const response = await startAuthentication({ optionsJSON: o.options });
  await post("/auth/step-up/verify", { challengeId: o.challengeId, response });
  const st = useAuth.getState().state;
  if (st.status === "in") set({ status: "in", me: { ...st.me, steppedUp: true } });
}

/** Runs a request; if the backend asks for a fresh passkey check, does it and tries once more. */
export async function withStepUp<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof ApiError && e.code === "step_up_required") { await stepUp(); return fn(); } throw e; }
}

/** Adds another passkey (this phone or laptop) to the signed-in person's account. */
export async function addPasskey() {
  const o = await withStepUp(() => post<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/auth/passkeys/options"));
  const response = await startRegistration({ optionsJSON: o.options });
  await post("/auth/passkeys/verify", { challengeId: o.challengeId, response, deviceLabel: deviceLabel() });
}


function deviceLabel() {
  if (typeof navigator === "undefined") return "browser";
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "browser";
  return `${br} on ${os}`;
}
