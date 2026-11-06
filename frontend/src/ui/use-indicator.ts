"use client";
import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Measures the element matching `selector` inside `root` so a single thumb can slide under the active item.
 * Re-measures when `dep` changes and whenever the root or its children resize. `ready` turns true one frame
 * after the first measurement, so the thumb appears in place instead of sliding in from the left.
 */
export function useIndicator(root: RefObject<HTMLElement | null>, selector: string, dep: unknown, childSelector = "button") {
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const on = el.querySelector<HTMLElement>(selector);
      if (on) setBox((b) => (b && b.x === on.offsetLeft && b.w === on.offsetWidth ? b : { x: on.offsetLeft, w: on.offsetWidth }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll(childSelector).forEach((c) => ro.observe(c));
    const raf = requestAnimationFrame(() => setReady(true));
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [root, selector, dep, childSelector]);
  return { box, ready };
}
