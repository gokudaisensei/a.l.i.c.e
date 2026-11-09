"use client";
import { useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icon";
import { project } from "./use-drag";
import { haptic } from "./haptics";
import { cn } from "./cn";

export interface DeviceTileProps {
  /** Name of an icon from the icon set. */
  icon: string;
  /** The device's name. */
  name: string;
  /** State line under the name, for example "60% · Living room". */
  detail: ReactNode;
  /** Whether the device is on: the tile glows. */
  on?: boolean;
  /** Needs attention (an unlocked door, for example). */
  warn?: boolean;
  /** 0–100. Draws a level fill from the bottom, like a dimmer. */
  fill?: number;
  /** Replaces the accessible name. Leave it out: then the visible name and state are the name, as "label in name" (WCAG 2.5.3) asks. */
  label?: string;
  /** What the gestures do, read after the name: "Tap to toggle. Hold for more." */
  hint?: string;
  /** Tap: usually toggles the device. */
  onTap: () => void;
  /** Fires after a half-second press. A tap that follows a hold is swallowed. */
  onHold?: () => void;
  /** Shows the chevron that opens the full controls (the tap-free twin of holding). */
  onMore?: () => void;
  /** Screen-reader name for the chevron. Defaults to "More controls for <name>". */
  moreLabel?: string;
  /** Colour the "on" glow (a lamp's own colour). */
  tint?: string;
  /** Seconds per turn: the icon spins (a fan). */
  spin?: number;
  /** Current level 0–100 for drag-to-set. A sideways drag on the tile sets it; the tile fills live and `onDragCommit` fires on release. */
  dragValue?: number;
  /** Called with the chosen level (0 to 100, in steps of 5) when a sideways drag ends. 0 means off. */
  onDragCommit?: (value: number) => void;
  className?: string;
}

const HOLD_MS = 430;

/**
 * Phone device tile. Tap to toggle. Drag sideways to set its main value: it ticks at each quarter, bumps at either end, stretches
 * if you pull past an end, and a flick carries on after you let go. Hold for more controls (or press the chevron): a slight press-in
 * shows the hold is coming, and a firm tap confirms it was recognised.
 */
export function DeviceTile({ icon, name, detail, on, warn, fill, label, onTap, onHold, onMore, moreLabel, tint, spin, dragValue, onDragCommit, className, hint }: DeviceTileProps) {
  const hintId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pressing, setPressing] = useState(false); // a hold is on its way: the tile presses in
  const [rb, setRb] = useState(0); // px stretched past an end of the drag (rubber-banding)
  const crossed = useRef(false);
  const stop = () => { if (timer.current) clearTimeout(timer.current); if (hintTimer.current) clearTimeout(hintTimer.current); setPressing(false); };
  const g = useRef<{ x: number; y: number; w: number; base: number; on: boolean } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const trail = useRef<{ t: number; v: number }[]>([]); // recent unrounded values, for the speed of the flick at release
  const canDrag = onDragCommit !== undefined && dragValue !== undefined;
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = g.current; if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) { if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.5) { if (Math.abs(dy) > 10) g.current = null; return; } s.on = true; stop(); fired.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch {} }
    const free = s.base + (dx / s.w) * 100, raw = Math.min(100, Math.max(0, free));
    const over = free < 0 ? free : free > 100 ? free - 100 : 0;
    setRb(over === 0 ? 0 : Math.sign(over) * (1 - 1 / (Math.abs(over) / 40 + 1)) * 22);
    if (over !== 0 && !crossed.current) haptic("boundary");
    crossed.current = over !== 0;
    const now = performance.now(); trail.current.push({ t: now, v: raw }); while (trail.current.length > 1 && now - trail.current[0].t > 90) trail.current.shift();
    const v = Math.round(raw / 5) * 5;
    if (v !== liveRef.current) { if (over === 0 && (v % 25 === 0 || v === 0 || v === 100)) haptic("detent"); liveRef.current = v; setLive(v); }
  };
  const end = () => {
    stop();
    if (g.current?.on && liveRef.current !== null) {
      // a flick carries on after the finger lifts: land where its speed would take it
      const a = trail.current[0], b = trail.current[trail.current.length - 1];
      const speed = a && b && b.t - a.t > 8 ? ((b.v - a.v) / 100 / (b.t - a.t)) * 1000 : 0; // fractions of the range per second
      const landed = Math.round((Math.min(1, Math.max(0, project((b?.v ?? liveRef.current) / 100, speed))) * 100) / 5) * 5;
      onDragCommit?.(landed);
    }
    trail.current = []; crossed.current = false; setRb(0);
    g.current = null; liveRef.current = null; setLive(null);
  };
  return (
    <div className={cn("dtw", className)} data-slot="device-tile">
      <button className={cn("dt", (on || (live ?? 0) > 0) && "is-on", warn && "warn", tint && "tinted", live !== null && "dragging")} aria-label={label} aria-describedby={hint ? hintId : undefined}
        data-pressing={pressing ? "" : undefined}
        style={({ ...(tint ? { "--tint": tint } : {}), ...(tint || canDrag ? { touchAction: "pan-y" } : {}), ...(rb ? { "--rb": `${rb}px` } : {}) }) as React.CSSProperties}
        onPointerDown={(e) => { fired.current = false; stop(); if (canDrag) g.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.getBoundingClientRect().width, base: dragValue!, on: false }; if (!onHold) return; hintTimer.current = setTimeout(() => setPressing(true), 120); timer.current = setTimeout(() => { fired.current = true; g.current = null; setPressing(false); haptic("hold"); onHold(); }, HOLD_MS); }}
        onPointerMove={canDrag ? move : undefined}
        onPointerUp={end} onPointerCancel={() => { stop(); g.current = null; liveRef.current = null; crossed.current = false; setRb(0); setLive(null); }} onPointerLeave={(e) => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) stop(); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => { if (fired.current) { fired.current = false; e.preventDefault(); return; } onTap(); }}>
        {(live ?? fill) !== undefined ? <i className="dfill" style={{ height: `${live ?? fill}%` }} /> : null}
        <span className={cn("dico", !!spin && "spin")} style={spin ? ({ "--spin": `${spin}s` } as React.CSSProperties) : undefined}><Icon n={icon} /></span>
        <span className="dn"><b>{name}</b><small>{detail}</small></span>
      </button>
      {hint ? <span id={hintId} className="sr">{hint}</span> : null}
      {onMore ? <button className="dmore" onClick={onMore} aria-label={moreLabel ?? `More controls for ${name}`}><Icon n="chev" /></button> : null}
    </div>
  );
}

/** Dashed "add" tile that sits at the end of a device grid. */
export function AddTile({ onClick, hint, children, className }: {
  /** Called when the tile is pressed. */
  onClick: () => void;
  /** A small line under the label. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("dtw", className)} data-slot="add-tile"><button type="button" className="dt add" onClick={onClick}><Icon n="plus" />{children}{hint ? <small>{hint}</small> : null}</button></div>;
}
