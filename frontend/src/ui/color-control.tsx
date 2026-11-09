"use client";
import { useEffect, useRef, useState } from "react";
import { hsvToRgb, rgbToHsv, kelvinToRgb, css, type RGB } from "@/lib/color";
import { project, useDrag } from "./use-drag";
import { haptic } from "./haptics";
import { useDoubleTap } from "./use-double-tap";
import { cn } from "./cn";

/**
 * Colour wheel: angle is hue, distance from the centre is saturation. Previews while dragging, commits on release. It ticks each
 * 30 degrees of hue, clicks at the centre (white) and bumps at the rim. Double-tap to go straight to white.
 */
export function ColorWheel({ rgb, onCommit, label, className }: {
  /** The current colour as `[red, green, blue]`, each 0 to 255. */
  rgb: RGB;
  /** Called with the chosen colour when the finger lifts (not on every move). */
  onCommit: (rgb: RGB) => void;
  /** Names the wheel for screen readers: "Lamp colour". */
  label: string;
  className?: string;
}) {
  const [hs, setHs] = useState<[number, number]>(() => { const [h, s] = rgbToHsv(rgb); return [h, s]; });
  const dragging = useRef(false);
  const key = rgb.join();
  useEffect(() => { if (!dragging.current) { const [h, s] = rgbToHsv(rgb); setHs([h, s]); } }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useRef(hs);
  const pick = (x: number, y: number) => {
    dragging.current = true;
    const dx = x - 0.5, dy = y - 0.5, d = Math.hypot(dx, dy) * 2;
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, s = Math.min(1, d);
    const [ph, ps] = latest.current;
    if (s <= 0.05 && ps > 0.05) haptic("detent"); // through the centre: white
    else if (s >= 1 && ps < 1) haptic("boundary"); // out to the rim
    else if (Math.round(h / 30) !== Math.round(ph / 30)) haptic("tick"); // every 30 degrees of hue
    latest.current = [h, s];
    setHs([h, s]);
  };
  const drag = useDrag((x, y) => pick(x, y), (x, y) => { pick(x, y); dragging.current = false; onCommit(hsvToRgb(...latest.current)); });
  const white = useDoubleTap(() => { const [h0] = latest.current; haptic("medium"); latest.current = [h0, 0]; setHs([h0, 0]); onCommit(hsvToRgb(h0, 0)); });
  const [h, s] = hs, a = h * Math.PI / 180;
  const cur = css(hsvToRgb(h, s));
  return (
    <div data-slot="color-wheel" className={cn("cwheel", className)} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(h)} aria-valuetext={`Hue ${Math.round(h)} degrees, ${Math.round(s * 100)}% saturation`} tabIndex={0}
      {...drag} onPointerDown={(e) => { drag.onPointerDown(e); white.onPointerDown(e); }} onPointerUp={(e) => { drag.onPointerUp(e); white.onPointerUp(e); }}
      onKeyDown={(e) => { const dh = e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0; if (dh) { const n = (h + dh + 360) % 360; setHs([n, Math.max(s, 0.5)]); onCommit(hsvToRgb(n, Math.max(s, 0.5))); } }}>
      <i className="cthumb" style={{ left: `${50 + Math.cos(a) * s * 50}%`, top: `${50 + Math.sin(a) * s * 50}%`, background: cur }} />
    </div>
  );
}

/** Warm-to-cool strip for white light. The track shows the real colour at each end of the lamp's range. */
export function WhiteStrip({ kelvin, min, max, onCommit, label, className }: {
  /** The current colour temperature in Kelvin. */
  kelvin: number;
  /** The warmest the lamp can go, in Kelvin (the left end). */
  min: number;
  /** The coolest the lamp can go, in Kelvin (the right end). */
  max: number;
  /** Called with the chosen temperature when the finger lifts. */
  onCommit: (k: number) => void;
  /** Names the strip for screen readers. */
  label: string;
  className?: string;
}) {
  const [k, setK] = useState(kelvin);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setK(kelvin); }, [kelvin]);
  const at = (x: number) => Math.round((min + x * (max - min)) / 50) * 50;
  const grad = Array.from({ length: 6 }, (_, i) => css(kelvinToRgb(min + (i / 5) * (max - min)))).join(",");
  const drag = useDrag((x) => { dragging.current = true; const n = at(x); if ((n <= min || n >= max) && k > min && k < max) haptic("boundary"); else if (Math.round(n / 500) !== Math.round(k / 500)) haptic("tick"); setK(n); }, (x, _y, _el, v) => { dragging.current = false; const n = at(Math.min(1, Math.max(0, project(x, v.vx)))); setK(n); onCommit(n); });
  const p = ((k - min) / (max - min)) * 100;
  return (
    <div data-slot="white-strip" className={cn("wstrip", className)} role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={k} aria-valuetext={`${k} Kelvin`} tabIndex={0}
      style={{ background: `linear-gradient(90deg,${grad})` }} {...drag}
      onKeyDown={(e) => { const d = e.key === "ArrowRight" ? 200 : e.key === "ArrowLeft" ? -200 : 0; if (d) { const n = Math.min(max, Math.max(min, k + d)); setK(n); onCommit(n); } }}>
      <i className="wthumb" style={{ left: `${p}%`, background: css(kelvinToRgb(k)) }} />
      <small className="wk">{k}K</small>
    </div>
  );
}

/**
 * A window with a shade you pull: drag down to close, up to open. Previews live, commits on release. It clicks at each quarter,
 * and if you pull past either end it stretches with growing resistance and bumps, then settles back. A flick carries on.
 */
export function CoverShade({ pos, moving, onCommit, label, className }: {
  /** How open the cover is: 0 closed, 100 open. */
  pos: number;
  /** Pulses the handle while the cover is moving. */
  moving: boolean;
  /** Called with the chosen position when the finger lifts. */
  onCommit: (p: number) => void;
  /** Names the control for screen readers. */
  label: string;
  className?: string;
}) {
  const [p, setP] = useState(pos);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setP(pos); }, [pos]);
  const [rb, setRb] = useState(0); // px the pull has stretched past an end: the further, the harder (rubber-banding)
  const past = useRef(false);
  const at = (y: number) => Math.round(((1 - y) * 100) / 5) * 5;
  const drag = useDrag((_, y, _el, raw) => {
    dragging.current = true;
    const n = at(y), over = raw.y < 0 ? raw.y : raw.y > 1 ? raw.y - 1 : 0;
    setRb(over === 0 ? 0 : Math.sign(over) * (1 - 1 / (Math.abs(over) * 3 + 1)) * 28);
    if (over !== 0 && !past.current) haptic("boundary"); else if (over === 0 && n !== p) haptic(n % 25 === 0 ? "detent" : "tick");
    past.current = over !== 0;
    setP(n);
  }, (_, y, _el, v) => { dragging.current = false; setRb(0); past.current = false; const n = at(Math.min(1, Math.max(0, project(y, v.vy)))); setP(n); onCommit(n); });
  return (
    <div data-slot="cover-shade" className={cn("cshade", className)} role="slider" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} tabIndex={0} data-moving={moving || undefined} {...drag}
      onKeyDown={(e) => { const d = e.key === "ArrowUp" ? 10 : e.key === "ArrowDown" ? -10 : 0; if (d) { const n = Math.min(100, Math.max(0, p + d)); setP(n); onCommit(n); } }}>
      <i className="cpane" /><i className="cblind" style={{ height: `max(0px, calc(${100 - p}% + ${rb}px))` }} /><i className="chandle" style={{ top: `${100 - p}%`, translate: `0 ${rb}px` }} />
    </div>
  );
}
