"use client";
import { useEffect, useRef } from "react";
import { StepButton } from "./button";
import { Icon } from "./icon";
import { cn } from "./cn";

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Shown after the number, e.g. "backups" or "h". */
  unit?: string;
  /** Names the control for screen readers, e.g. "Backups to keep". */
  label: string;
  className?: string;
}

const HOLD_DELAY = 420;
const HOLD_EVERY = 90;

/**
 * A number you nudge up and down with round buttons, held between `min` and `max`. Press and hold to run through
 * a range; arrow keys work too. For small counts, not free typing.
 */
export function Stepper({ value, onChange, min, max, step = 1, unit, label, className }: StepperProps) {
  const now = useRef(value);
  useEffect(() => { now.current = value; }, [value]);
  const timers = useRef<{ wait?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>; held: boolean }>({ held: false });
  const move = (dir: 1 | -1) => onChange(Math.min(max, Math.max(min, now.current + dir * step)));
  const stop = () => { clearTimeout(timers.current.wait); clearInterval(timers.current.tick); };
  const start = (dir: 1 | -1) => { timers.current.held = false; stop(); timers.current.wait = setTimeout(() => { timers.current.held = true; timers.current.tick = setInterval(() => move(dir), HOLD_EVERY); }, HOLD_DELAY); };
  const tap = (dir: 1 | -1) => { if (timers.current.held) { timers.current.held = false; return; } move(dir); };
  return (
    <div data-slot="stepper" role="group" aria-label={label} className={cn("stepper", className)}
      onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); move(1); } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); move(-1); } }}>
      <StepButton aria-label={`Fewer: ${label}`} disabled={value <= min} onPointerDown={() => start(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onClick={() => tap(-1)}><Icon n="minus" /></StepButton>
      <output className="stepper-v num" aria-live="polite">{value}{unit ? <small> {unit}</small> : null}</output>
      <StepButton aria-label={`More: ${label}`} disabled={value >= max} onPointerDown={() => start(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onClick={() => tap(1)}><Icon n="plus" /></StepButton>
    </div>
  );
}
