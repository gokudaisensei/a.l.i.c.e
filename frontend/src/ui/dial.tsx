"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDrag } from "./use-drag";
import { cn } from "./cn";
import { haptic } from "./haptics";
import { useDoubleTap } from "./use-double-tap";

const START = 135, SWEEP = 270; // degrees, clockwise from 3 o'clock; the gap is at the bottom
const pt = (cx: number, r: number, deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cx + r * Math.sin((deg * Math.PI) / 180)];
const arc = (cx: number, r: number, a: number, b: number) => { const [x1, y1] = pt(cx, r, a), [x2, y2] = pt(cx, r, b); return `M${x1} ${y1}A${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`; };

export interface DialProps {
  value: number;
  min: number;
  max: number;
  /** Size of one step: the dial snaps to multiples of it. */
  step?: number;
  /** Called with the chosen value when the finger lifts. */
  onCommit: (v: number) => void;
  /** Names the dial for screen readers: "Target temperature". */
  label: string;
  /** Shown after the value for screen readers ("24 degrees"), for example "°". */
  unit?: string;
  className?: string;
  /** Double-tap the dial to return to this value (a default). Leave it out for no reset. */
  resetValue?: number;
  /** A second marker on the track (the room's current temperature). */
  marker?: number;
  /** Colour of the filled arc. */
  color?: string;
  /** Show live while dragging (for the centre text). */
  children?: (v: number) => ReactNode;
}

/** Radial dial: drag around a 270° arc. Previews while dragging, commits on release. */
export function Dial({ value, min, max, step = 1, onCommit, label, unit = "", marker, color = "var(--glow)", className, resetValue, children }: DialProps) {
  const [v, setV] = useState(value);
  const dragging = useRef(false);
  const prev = useRef(value);
  useEffect(() => { if (!dragging.current) setV(value); }, [value]);
  const at = (x: number, y: number) => {
    let deg = (Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI; if (deg < 0) deg += 360;
    let rel = deg - START; if (rel < 0) rel += 360;
    if (rel > SWEEP) rel = rel - SWEEP < (360 - SWEEP) / 2 ? SWEEP : 0; // in the gap: snap to the nearer end
    const raw = min + (rel / SWEEP) * (max - min);
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  };
  const dbl = useDoubleTap(() => { if (resetValue !== undefined) { haptic("medium"); prev.current = resetValue; setV(resetValue); onCommit(resetValue); } });
  const drag = useDrag((x, y) => {
    dragging.current = true;
    const n = at(x, y);
    // jumping across the gap in one move is a wrap, not a drag
    if (Math.abs(n - prev.current) > (max - min) * 0.6) return;
    if (n !== prev.current) {
      const q = (x: number) => Math.floor(((x - min) / (max - min)) * 4), was = prev.current;
      if ((n <= min || n >= max) && was > min && was < max) haptic("boundary"); // reached an end: a bump
      else if (q(n) !== q(was)) haptic("detent"); // a quarter of the way
      else haptic("tick");
      prev.current = n; setV(n);
    }
  }, () => { dragging.current = false; onCommit(prev.current); });
  const f = (n: number) => (n - min) / (max - min);
  const S = 220, cx = S / 2, r = 90, end = START + SWEEP * f(v);
  const [kx, ky] = pt(cx, r, end);
  const m = marker !== undefined && marker >= min && marker <= max ? pt(cx, r + 14, START + SWEEP * f(marker)) : null;
  return (
    <div data-slot="dial" className={cn("dial", className)} role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={v} aria-valuetext={`${v}${unit}`} tabIndex={0} {...drag} onPointerDown={(e) => { drag.onPointerDown(e); if (resetValue !== undefined) dbl.onPointerDown(e); }} onPointerUp={(e) => { drag.onPointerUp(e); if (resetValue !== undefined) dbl.onPointerUp(e); }}
      onKeyDown={(e) => { const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0; if (d) { const n = Math.min(max, Math.max(min, v + d)); prev.current = n; setV(n); onCommit(n); } }}>
      <svg viewBox={`0 0 ${S} ${S}`} aria-hidden>
        <path d={arc(cx, r, START, START + SWEEP)} className="dial-t" />
        {f(v) > 0 ? <path d={arc(cx, r, START, Math.max(START + 0.01, end))} className="dial-f" style={{ stroke: color }} /> : null}
        {m ? <circle cx={m[0]} cy={m[1]} r="3.5" className="dial-m" /> : null}
        <circle cx={kx} cy={ky} r="14" className="dial-k" />
      </svg>
      <div className="dial-c">{children ? children(v) : <b className="num">{v}{unit}</b>}</div>
    </div>
  );
}
