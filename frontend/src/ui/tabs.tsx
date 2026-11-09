"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "./cn";
import { useIndicator } from "./use-indicator";
import { useSwipeSelect } from "./use-swipe-select";
import { haptic } from "./haptics";

export interface TabsProps<T extends string> extends Omit<ComponentProps<"div">, "onChange" | "children" | "role" | "aria-label"> {
  value: T;
  /** `badge` shows a small dot: something in that tab needs a look. */
  tabs: { id: T; label: string; badge?: boolean }[];
  onChange: (id: T) => void;
  /** Names the tab list for screen readers. */
  label: string;
}

/** Pill tab bar. A dark thumb slides to the chosen tab, and the bar scrolls sideways when it does not fit. */
export function Tabs<T extends string>({ value, tabs, onChange, label, className, style, ...rest }: TabsProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  // Swiping across the tabs only makes sense when they all fit. When they do not, a sideways swipe scrolls the list instead.
  const [roomy, setRoomy] = useState(true);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const ro = new ResizeObserver(() => setRoomy(el.scrollWidth <= el.clientWidth + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);
  const { box, ready } = useIndicator(root, "[aria-selected=true]", `${value}|${tabs.length}`);
  const choose = (id: T) => { if (id !== value) haptic("select"); onChange(id); };
  const swipe = useSwipeSelect({ index: Math.max(0, tabs.findIndex((t) => t.id === value)), onIndex: (i) => choose(tabs[i].id), itemSelector: ".tab" });
  return (
    <div ref={root} data-slot="tabs" className={cn("tabs", className)} role="tablist" aria-label={label} style={{ ...style, ...(roomy ? { touchAction: "pan-y" } : {}) }} {...rest} {...(roomy ? swipe : {})}>
      {box ? <span className={cn("tab-ind", ready && "ready")} aria-hidden="true" style={{ width: box.w, transform: `translateX(${box.x}px)` }} /> : null}
      {tabs.map((t) => (
        <button key={t.id} type="button" className="tab" role="tab" aria-selected={value === t.id} onClick={() => choose(t.id)}>
          {t.label}{t.badge ? <span className="dotb" title="Needs a look" /> : null}
        </button>
      ))}
    </div>
  );
}
