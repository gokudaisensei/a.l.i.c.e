"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { IconButton } from "./button";
import { cn } from "./cn";
import { haptic } from "./haptics";
import { project } from "./use-drag";

export type ToastTone = "neutral" | "ok" | "warn";

export interface ToastProps {
  /** What happened, in plain words. */
  message: string;
  /** A short bold line above the message, for longer notices. */
  title?: string;
  /** `warn` is announced to screen readers at once and shows an alert icon. */
  tone?: ToastTone;
  /** Whether it is on screen. */
  show: boolean;
  /** Called when the time is up or the close button is pressed. */
  onDismiss?: () => void;
  /** Shows an Undo button; the toast stays a little longer. */
  onUndo?: () => void;
  /** How long it stays, in ms: by default it grows with the message (3.2 s to 10 s). `null` keeps it until dismissed, which is the default for `warn` (a failure is never taken away before it is read). */
  duration?: number | null;
  /** `fixed` sits at the bottom of the screen above the phone's tab bar; `inline` flows with the page (for the library page). */
  placement?: "fixed" | "inline";
  className?: string;
}

/** How long to leave a message up: enough to read it, never less than 3.2 s, never more than 10 s. */
export const toastDuration = (message: string, title?: string, withUndo?: boolean) =>
  Math.min(10_000, Math.max(3_200, 2_000 + (message.length + (title?.length ?? 0)) * 45)) + (withUndo ? 2_500 : 0);

const ICON: Record<ToastTone, string | null> = { neutral: null, ok: "check", warn: "alert" };
const CLAMP_LINES = 5;

/**
 * A short notice that appears at the bottom of the screen. It is a card, not a pill: long messages wrap (and, past five
 * lines, are cut with a tap to read the rest). It pauses while it is being pointed at or touched, so it cannot vanish
 * mid-sentence, and warnings are announced to screen readers straight away.
 */
export function Toast({ message, title, tone = "neutral", show, onDismiss, onUndo, duration, placement = "fixed", className }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null); // the message shown in full (a new message starts folded again)
  const key = `${title ?? ""}|${message}`;
  const open = openFor === key;
  const long = message.length > 140; // about five lines on a phone: worth a "Show more"
  const persist = !!onDismiss && (duration === null || (duration === undefined && tone === "warn")); // Apple: a message that matters is not removed on a timer
  const total = typeof duration === "number" ? duration : toastDuration(message, title, !!onUndo);
  const left = useRef(total);
  const started = useRef(0);

  // It tells you in the hand as well as on screen: a warning is felt, a success is felt, a plain note is not.
  useEffect(() => { if (show) { if (tone === "warn") haptic("warning"); else if (tone === "ok") haptic("success"); } }, [show, tone, message, title]);

  // Swipe it away: sideways either way, or down. Past a distance, or flicked fast enough to get there, it leaves; otherwise it springs back.
  const [swipe, setSwipe] = useState<{ x: number; y: number } | null>(null);
  const [held, setHeld] = useState(false); // a finger is on it: it follows exactly, with no easing
  const hand = useRef<{ id: number; x: number; y: number; t: number; moved: boolean; vx: number } | null>(null);
  const near = (t: EventTarget) => (t as HTMLElement).closest?.("button, a");
  const leave = (x: number, y: number) => { setSwipe({ x, y }); haptic("light"); setTimeout(() => { onDismiss?.(); setSwipe(null); }, 170); };

  // A new message starts its clock afresh.
  useEffect(() => { left.current = total; }, [message, title, total, show]);

  // The clock: runs while shown and not paused; remembers what is left when paused.
  useEffect(() => {
    if (!show || paused || !onDismiss || persist) return;
    started.current = performance.now();
    const t = setTimeout(onDismiss, left.current);
    return () => { clearTimeout(t); left.current = Math.max(400, left.current - (performance.now() - started.current)); };
  }, [show, paused, onDismiss, message, title, persist]);

  const icon = ICON[tone];
  return (
    <div
      data-slot="toast" data-show={show} data-tone={tone} data-placement={placement} data-paused={paused}
      role={tone === "warn" ? "alert" : "status"} aria-live={tone === "warn" ? "assertive" : "polite"} aria-atomic="true"
      className={cn("toast", className)} inert={!show}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)} onTouchEnd={() => setTimeout(() => setPaused(false), 1200)}
      data-swiping={swipe && held ? "" : undefined}
      style={swipe ? ({ "--sx": `${swipe.x}px`, "--sy": `${swipe.y}px`, opacity: Math.max(0.2, 1 - Math.hypot(swipe.x, swipe.y) / 320) } as React.CSSProperties) : undefined}
      onPointerDown={(e) => { if (!onDismiss || near(e.target)) return; hand.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, vx: 0 }; }}
      onPointerMove={(e) => {
        const h = hand.current; if (!h || e.pointerId !== h.id) return;
        const dx = e.clientX - h.x, dy = Math.max(0, e.clientY - h.y), now = performance.now();
        if (!h.moved) { if (Math.hypot(dx, dy) < 7) return; h.moved = true; setHeld(true); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* it still follows inside the card */ } }
        h.vx = (dx - (swipe?.x ?? 0)) / Math.max(1, now - h.t); h.t = now;
        setSwipe({ x: dx, y: dy });
      }}
      onPointerUp={() => {
        const h = hand.current; hand.current = null; setHeld(false);
        if (!h?.moved || !swipe) return;
        const reach = Math.abs(project(swipe.x / 400, h.vx * 1000 / 400, 0.99) * 400); // where a flick would carry it, in px
        if (Math.abs(swipe.x) > 110 || reach > 190 || swipe.y > 56) leave(swipe.x + Math.sign(swipe.x || 1) * (swipe.y > 56 ? 0 : 240), swipe.y > 56 ? swipe.y + 160 : swipe.y);
        else setSwipe(null);
      }}
      onPointerCancel={() => { hand.current = null; setHeld(false); setSwipe(null); }}
    >
      {icon ? <span className="toast-i" aria-hidden="true"><Icon n={icon} c="sm" /></span> : null}
      <div className="toast-b">
        {title ? <b className="toast-h">{title}</b> : null}
        <p className={cn("toast-t", !open && "clamp")} style={{ ["--lines" as string]: CLAMP_LINES }}>{message}</p>
        {long ? <button type="button" className="toast-more" onClick={() => setOpenFor(open ? null : key)}>{open ? "Show less" : "Show more"}</button> : null}
      </div>
      <div className="toast-a">
        {onUndo ? <button type="button" className="toast-undo" onClick={() => { haptic("select"); onUndo(); }}>Undo</button> : null}
        {onDismiss ? <IconButton className="toast-x" aria-label="Dismiss" onClick={onDismiss}><Icon n="x" c="sm" /></IconButton> : null}
      </div>
      {show && onDismiss && !persist ? <i className="toast-bar" style={{ animationDuration: `${total}ms` }} aria-hidden="true" /> : null}
    </div>
  );
}
