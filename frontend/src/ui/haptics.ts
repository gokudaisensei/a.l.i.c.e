"use client";
import { useSyncExternalStore } from "react";

/**
 * Haptics with meanings. Components never ask for "vibrate 12 ms"; they say what happened, and this file decides what that
 * feels like, how often it may happen, and whether the person wants it at all.
 *
 *   tick       passing through steps while scrubbing (the lightest: rate limited)
 *   detent     passing a notable value on the way: a quarter, the centre, white
 *   select     a choice changed: a segment, a tab, a preset, a chip
 *   toggleOn   something switched on (a touch firmer than off, so on and off feel different)
 *   toggleOff  something switched off
 *   light      a tap was understood
 *   medium     a bigger step: a command went out, a sheet opened
 *   heavy      the biggest: reserved for the one thing that must be felt
 *   boundary   you hit the end of a range: a small bump
 *   hold       a long press was recognised
 *   success    it worked
 *   warning    something needs a look
 *   error      it failed
 *
 * Android Chrome vibrates through `navigator.vibrate` (a plain pulse: the length is the only strength control; measured on a real phone it plays
 * each pulse a few milliseconds longer than asked, so the tiers are spaced well apart). iPhone has no vibration API: where the platform allows it, a hidden "switch" checkbox is clicked, which
 * Safari answers with a tap (iOS 17.4 and later; not verified on a device). Elsewhere nothing happens, and nothing breaks.
 */
export type Haptic = "tick" | "detent" | "select" | "toggleOn" | "toggleOff" | "light" | "medium" | "heavy" | "boundary" | "hold" | "success" | "warning" | "error";

export const HAPTICS: Record<Haptic, { pattern: number | number[]; label: string; use: string }> = {
  // The lengths are spread on purpose. Measured on a real phone (Motorola edge 50 pro, Chrome): Android plays a pulse about 5 to 8 ms
  // longer than asked, and 4, 7 and 8 ms all came out as roughly 11 to 12 ms, i.e. the same to a finger. Tiers that are meant to feel
  // different are therefore at least 6 ms apart, and the bigger ones add a second pulse, which reads as a different shape, not just a longer one.
  tick: { pattern: 5, label: "Tick", use: "Passing through steps while scrubbing a slider, dial or stepper." },
  detent: { pattern: 14, label: "Detent", use: "Passing a notable value on the way: a quarter, the centre, white." },
  select: { pattern: 12, label: "Select", use: "A choice changed: a segment, a tab, a preset, a chip, an option." },
  toggleOn: { pattern: 17, label: "Toggle on", use: "Something switched on. Firmer than off." },
  toggleOff: { pattern: 9, label: "Toggle off", use: "Something switched off." },
  light: { pattern: 12, label: "Light", use: "A tap was understood." },
  medium: { pattern: 21, label: "Medium", use: "A bigger step: a command went out, a sheet opened." },
  heavy: { pattern: 36, label: "Heavy", use: "Reserved for the one thing that must be felt." },
  boundary: { pattern: [8, 24, 18], label: "Boundary", use: "You hit the end of a range: a small bump." },
  hold: { pattern: 22, label: "Hold", use: "A long press was recognised." },
  success: { pattern: [10, 40, 18], label: "Success", use: "It worked." },
  warning: { pattern: [24, 60, 24], label: "Warning", use: "Something needs a look." },
  error: { pattern: [28, 45, 28, 45, 46], label: "Error", use: "It failed." },
};

const KEY = "alice.haptics";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
let enabled = typeof window === "undefined" ? true : read();
let last = 0;

const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
let iosSwitch: HTMLElement | null = null;
function iosTap() {
  if (!iosSwitch) {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    const box = document.createElement("input");
    box.type = "checkbox"; box.setAttribute("switch", ""); box.tabIndex = -1;
    label.appendChild(box); document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

/** True where a haptic can be felt at all: Android Chrome's vibrate, or the iPhone path. */
export const hapticsSupported = () => typeof navigator !== "undefined" && (typeof navigator.vibrate === "function" || isIOS());

/** Plays one haptic. Does nothing when the person turned haptics off, when the device cannot, or when it is too soon after the last one. */
export function haptic(kind: Haptic) {
  if (!enabled || typeof navigator === "undefined") return;
  const now = performance.now();
  if ((kind === "tick" || kind === "detent") && now - last < 28) return; // a fast drag must not become a buzz
  last = now;
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(HAPTICS[kind].pattern);
    else if (isIOS() && kind !== "tick") iosTap();
  } catch { /* a browser that refuses (no recent touch, a hidden frame) is not an error */ }
}

/** Turns haptics on or off for this device, and remembers it. */
export function setHapticsEnabled(on: boolean) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window: it lasts until the page closes */ }
  listeners.forEach((f) => f());
}

/** The setting, for a switch: `[enabled, setEnabled]`. */
export function useHapticsEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => enabled, () => true);
  return [on, setHapticsEnabled];
}
