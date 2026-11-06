"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { IconButton } from "./button";
import { cn } from "./cn";

export type ToastTone = "neutral" | "ok" | "warn";

export interface ToastProps {
  message: string;
  /** A short bold line above the message, for longer notices. */
  title?: string;
  tone?: ToastTone;
  show: boolean;
  /** Called when the time is up or the close button is pressed. */
  onDismiss?: () => void;
  /** Shows an Undo button; the toast stays a little longer. */
  onUndo?: () => void;
  /** How long it stays, in ms. Default grows with the length of the message (3.2 s to 10 s). */
  duration?: number;
  /** `fixed` sits at the bottom of the screen above the phone's tab bar; `inline` flows with the page (for the library page). */
  placement?: "fixed" | "inline";
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
export function Toast({ message, title, tone = "neutral", show, onDismiss, onUndo, duration, placement = "fixed" }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null); // the message shown in full (a new message starts folded again)
  const key = `${title ?? ""}|${message}`;
  const open = openFor === key;
  const long = message.length > 140; // about five lines on a phone: worth a "Show more"
  const total = duration ?? toastDuration(message, title, !!onUndo);
  const left = useRef(total);
  const started = useRef(0);

  // A new message starts its clock afresh.
  useEffect(() => { left.current = total; }, [message, title, total, show]);

  // The clock: runs while shown and not paused; remembers what is left when paused.
  useEffect(() => {
    if (!show || paused || !onDismiss) return;
    started.current = performance.now();
    const t = setTimeout(onDismiss, left.current);
    return () => { clearTimeout(t); left.current = Math.max(400, left.current - (performance.now() - started.current)); };
  }, [show, paused, onDismiss, message, title]);

  const icon = ICON[tone];
  return (
    <div
      data-slot="toast" data-show={show} data-tone={tone} data-placement={placement} data-paused={paused}
      role={tone === "warn" ? "alert" : "status"} aria-live={tone === "warn" ? "assertive" : "polite"} aria-atomic="true"
      className="toast" inert={!show}
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)} onTouchEnd={() => setTimeout(() => setPaused(false), 1200)}
    >
      {icon ? <span className="toast-i" aria-hidden="true"><Icon n={icon} c="sm" /></span> : null}
      <div className="toast-b">
        {title ? <b className="toast-h">{title}</b> : null}
        <p className={cn("toast-t", !open && "clamp")} style={{ ["--lines" as string]: CLAMP_LINES }}>{message}</p>
        {long ? <button type="button" className="toast-more" onClick={() => setOpenFor(open ? null : key)}>{open ? "Show less" : "Show more"}</button> : null}
      </div>
      <div className="toast-a">
        {onUndo ? <button type="button" className="toast-undo" onClick={onUndo}>Undo</button> : null}
        {onDismiss ? <IconButton className="toast-x" aria-label="Dismiss" onClick={onDismiss}><Icon n="x" c="sm" /></IconButton> : null}
      </div>
      {show && onDismiss ? <i className="toast-bar" style={{ animationDuration: `${total}ms` }} aria-hidden="true" /> : null}
    </div>
  );
}
