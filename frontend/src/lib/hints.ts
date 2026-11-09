"use client";
import { useSyncExternalStore } from "react";

/** One-time tips, remembered on this device. Storage may be unavailable (private windows), so every access is guarded. */
const KEY = (k: string) => `alice.hint.${k}`;
const subs = new Set<() => void>();
const mem = new Set<string>();
const seen = (k: string) => { if (mem.has(k)) return true; try { return localStorage.getItem(KEY(k)) === "1"; } catch { return false; } };

/** Mark a tip as learned, because the person did the thing or dismissed it. */
export function learned(k: string) {
  if (seen(k)) return;
  mem.add(k);
  try { localStorage.setItem(KEY(k), "1"); } catch {}
  subs.forEach((f) => f());
}
/** True until the tip has been learned. Not shown on the server render. */
export function useHint(k: string) {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => !seen(k), () => false);
}
