"use client";
import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Lets a row of choices be swiped: put a finger on one and slide, and the choice under it is selected as it passes (like
 * an iOS segmented control). A plain tap still clicks. `itemSelector` finds the items inside the element the props go on.
 */
export function useSwipeSelect({ index, onIndex, itemSelector }: { index: number; onIndex: (i: number) => void; itemSelector: string }) {
  const press = useRef<{ id: number; x: number; moved: boolean } | null>(null);
  const swallow = useRef(false);
  return {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { if (e.pointerType === "mouse" && e.button !== 0) return; if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth + 1) return; /* it scrolls sideways: a swipe is a scroll */ press.current = { id: e.pointerId, x: e.clientX, moved: false }; },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current; if (!p || e.pointerId !== p.id) return;
      if (!p.moved) { if (Math.abs(e.clientX - p.x) < 8) return; p.moved = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable: the swipe still works while the pointer stays inside */ } }
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>(itemSelector)];
      if (!items.length) return;
      const at = items.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right; });
      const next = at >= 0 ? at : e.clientX < items[0].getBoundingClientRect().left ? 0 : items.length - 1;
      if (next !== index) onIndex(next);
    },
    onPointerUp: () => { if (press.current?.moved) { swallow.current = true; setTimeout(() => { swallow.current = false; }, 0); } press.current = null; },
    onPointerCancel: () => { press.current = null; },
    // the click that follows a swipe must not choose again
    onClickCapture: (e: MouseEvent<HTMLElement>) => { if (swallow.current) { e.stopPropagation(); e.preventDefault(); } },
  } as const;
}
