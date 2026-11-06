"use client";
import { useRef } from "react";
import { cn } from "./cn";
import { useIndicator } from "./use-indicator";

export interface TabsProps<T extends string> {
  value: T;
  tabs: { id: T; label: string; badge?: boolean }[];
  onChange: (id: T) => void;
  label: string;
}

/** Pill tab bar. A dark thumb slides to the chosen tab, and the bar scrolls sideways when it does not fit. */
export function Tabs<T extends string>({ value, tabs, onChange, label }: TabsProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const { box, ready } = useIndicator(root, "[aria-selected=true]", `${value}|${tabs.length}`);
  return (
    <div ref={root} data-slot="tabs" className="tabs" role="tablist" aria-label={label}>
      {box ? <span className={cn("tab-ind", ready && "ready")} aria-hidden="true" style={{ width: box.w, transform: `translateX(${box.x}px)` }} /> : null}
      {tabs.map((t) => (
        <button key={t.id} type="button" className="tab" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}{t.badge ? <span className="dotb" title="Needs a look" /> : null}
        </button>
      ))}
    </div>
  );
}
