"use client";
import { useRef, type PointerEvent } from "react";

/**
 * Calls `onDouble` when the element is tapped twice quickly in the same place. A press that moved (a drag) is not a tap, so
 * dragging a control and then letting go never counts. Spread the result onto the element.
 */
export function useDoubleTap(onDouble: () => void, { within = 320, slop = 24 }: { within?: number; slop?: number } = {}) {
  const down = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ t: number; x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { down.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = down.current; down.current = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) { last.current = null; return; } // it moved: a drag, not a tap
      const now = performance.now(), l = last.current;
      if (l && now - l.t < within && Math.hypot(e.clientX - l.x, e.clientY - l.y) < slop) { last.current = null; onDouble(); }
      else last.current = { t: now, x: e.clientX, y: e.clientY };
    },
  };
}
