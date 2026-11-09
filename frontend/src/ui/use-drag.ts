"use client";
import { useRef, type PointerEvent } from "react";

/** Where the pointer is, as fractions of the element, *not* clamped: below 0 or above 1 means it is past the edge (for rubber-banding). */
export interface DragRaw { x: number; y: number }

/** How fast the pointer was moving when it lifted, as fractions of the element per second (positive is right and down). */
export interface DragVelocity { vx: number; vy: number }

/**
 * Where something flicked from `pos` (0 to 1) with velocity `vel` (fractions per second) comes to rest. A flick carries on after the
 * finger lifts, the way a scroll view does: the distance is the sum of a decelerating glide. `rate` is how quickly it slows
 * (0.998 glides a long way, 0.99 a short one). The result is not clamped.
 */
export const project = (pos: number, vel: number, rate = 0.99) => pos + ((vel / 1000) * rate) / (1 - rate);

const WINDOW_MS = 90; // velocity is read from the last moments of the drag, not its whole length

/**
 * Pointer-capture drag over an element. `move` gets the pointer as 0 to 1 fractions of the element's box (clamped), and as a fourth
 * argument the same position unclamped (so a control can stretch when pulled past its end);
 * `end` fires on release with the last position and the velocity at the moment of release (use it with `project`
 * to let a flick carry on). Props go on the element itself.
 */
export function useDrag(
  move: (x: number, y: number, el: HTMLElement, raw: DragRaw) => void,
  end?: (x: number, y: number, el: HTMLElement, v: DragVelocity) => void,
) {
  const live = useRef(false);
  const last = useRef<[number, number]>([0, 0]);
  const raw = useRef<DragRaw>({ x: 0, y: 0 });
  const trail = useRef<{ t: number; x: number; y: number }[]>([]);
  const at = (e: PointerEvent<HTMLElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    raw.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    return [Math.min(1, Math.max(0, raw.current.x)), Math.min(1, Math.max(0, raw.current.y))];
  };
  const note = () => {
    const now = performance.now(), [x, y] = last.current;
    trail.current.push({ t: now, x, y });
    while (trail.current.length > 1 && now - trail.current[0].t > WINDOW_MS) trail.current.shift();
  };
  const velocity = (): DragVelocity => {
    const a = trail.current[0], b = trail.current[trail.current.length - 1];
    const dt = a && b ? b.t - a.t : 0;
    return dt > 8 ? { vx: ((b.x - a.x) / dt) * 1000, vy: ((b.y - a.y) / dt) * 1000 } : { vx: 0, vy: 0 };
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { live.current = true; trail.current = []; e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); note(); move(...last.current, e.currentTarget, raw.current); },
    onPointerMove: (e: PointerEvent<HTMLElement>) => { if (!live.current) return; last.current = at(e); note(); move(...last.current, e.currentTarget, raw.current); },
    onPointerUp: (e: PointerEvent<HTMLElement>) => { if (!live.current) return; live.current = false; end?.(...last.current, e.currentTarget, velocity()); },
    onPointerCancel: () => { live.current = false; },
    "data-base-ui-swipe-ignore": true,
  } as const;
}
