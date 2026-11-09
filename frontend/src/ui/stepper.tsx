"use client";
import { useEffect, useRef, type ComponentProps } from "react";
import { StepButton } from "./button";
import { Icon } from "./icon";
import { cn } from "./cn";
import { haptic } from "./haptics";

export interface StepperProps extends Omit<ComponentProps<"div">, "onChange" | "children" | "role" | "aria-label"> {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Shown after the number, e.g. "backups" or "h". */
  unit?: string;
  /** Names the control for screen readers, e.g. "Backups to keep". */
  label: string;
}

const HOLD_DELAY = 420;
const SCRUB_PX = 14; // how far to drag the number for one step

/**
 * A number you nudge up and down with round buttons, held between `min` and `max`. Tap for one step. Press and hold to run through a
 * range: it starts steady and speeds up the longer you hold. Or drag the number itself sideways, one step every few pixels, like
 * scrubbing. Each step ticks, and reaching either end bumps. Arrow keys work too. For small counts, not free typing.
 */
export function Stepper({ value, onChange, min, max, step = 1, unit, label, className, onKeyDown, ...rest }: StepperProps) {
  const now = useRef(value);
  useEffect(() => { now.current = value; }, [value]);
  const timers = useRef<{ wait?: ReturnType<typeof setTimeout>; loop?: ReturnType<typeof setTimeout>; held: boolean }>({ held: false });
  const scrub = useRef<{ id: number; x: number; base: number; hit: boolean } | null>(null);

  /** One step. Returns false at the end of the range, with a bump instead of a tick. */
  const move = (dir: 1 | -1, kind: "light" | "tick" = "light") => {
    const next = Math.min(max, Math.max(min, now.current + dir * step));
    if (next === now.current) { haptic("boundary"); return false; }
    haptic(kind); now.current = next; onChange(next);
    return true;
  };
  const stop = () => { clearTimeout(timers.current.wait); clearTimeout(timers.current.loop); };
  const start = (dir: 1 | -1) => {
    timers.current.held = false; stop();
    timers.current.wait = setTimeout(() => {
      timers.current.held = true;
      let n = 0;
      const run = () => { if (!move(dir, "tick")) return; n++; timers.current.loop = setTimeout(run, Math.max(35, 130 - n * 8)); }; // faster the longer it is held
      run();
    }, HOLD_DELAY);
  };
  const tap = (dir: 1 | -1) => { if (timers.current.held) { timers.current.held = false; return; } move(dir); };

  const dragDown = (e: React.PointerEvent<HTMLOutputElement>) => { scrub.current = { id: e.pointerId, x: e.clientX, base: now.current, hit: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* still scrubs inside the number */ } };
  const dragMove = (e: React.PointerEvent<HTMLOutputElement>) => {
    const s = scrub.current; if (!s || e.pointerId !== s.id) return;
    const steps = Math.trunc((e.clientX - s.x) / SCRUB_PX);
    const raw = s.base + steps * step, target = Math.min(max, Math.max(min, raw));
    if (target !== now.current) { haptic("tick"); now.current = target; onChange(target); }
    if (raw !== target && !s.hit) { s.hit = true; haptic("boundary"); } else if (raw === target) s.hit = false;
  };
  return (
    <div data-slot="stepper" role="group" aria-label={label} className={cn("stepper", className)} {...rest}
      onKeyDown={(e) => { onKeyDown?.(e); if (e.defaultPrevented) return; if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); move(1); } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); move(-1); } }}>
      <StepButton aria-label={`Fewer: ${label}`} disabled={value <= min} onPointerDown={() => start(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onClick={() => tap(-1)}><Icon n="minus" /></StepButton>
      <output className="stepper-v num" aria-live="polite" title="Drag sideways to change" onPointerDown={dragDown} onPointerMove={dragMove} onPointerUp={() => { scrub.current = null; }} onPointerCancel={() => { scrub.current = null; }}>{value}{unit ? <small> {unit}</small> : null}</output>
      <StepButton aria-label={`More: ${label}`} disabled={value >= max} onPointerDown={() => start(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onClick={() => tap(1)}><Icon n="plus" /></StepButton>
    </div>
  );
}
