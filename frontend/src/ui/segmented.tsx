"use client";
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useIndicator } from "./use-indicator";
import { cn } from "./cn";

export interface SegmentedProps<T extends string | number> {
  value: T;
  items: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  label?: string;
  style?: CSSProperties;
  className?: string;
}

/**
 * Single-choice control. A thumb slides between segments on a spring, arrow keys move the choice
 * (roving tabindex, like a native radio group), and it behaves as a radiogroup for assistive tech.
 */
export function Segmented<T extends string | number>({ value, items, onChange, label, style, className }: SegmentedProps<T>) {
  const root = useRef<HTMLSpanElement>(null);
  const { box, ready } = useIndicator(root, "[aria-checked=true]", `${String(value)}|${items.length}`);

  const onKey = (e: KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, items.findIndex(([k]) => k === value));
    const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    onChange(items[n][0]);
    requestAnimationFrame(() => root.current?.querySelectorAll<HTMLElement>("button")[n]?.focus());
  };

  return (
    <span ref={root} data-slot="segmented" className={cn("seg", className)} role="radiogroup" aria-label={label} style={style} onKeyDown={onKey}>
      {box ? <span className={cn("seg-ind", ready && "ready")} aria-hidden="true" style={{ width: box.w, transform: `translateX(${box.x}px)` }} /> : null}
      {items.map(([k, l]) => (
        <button key={String(k)} type="button" role="radio" aria-checked={value === k} tabIndex={value === k || (!items.some(([x]) => x === value) && k === items[0][0]) ? 0 : -1} onClick={() => onChange(k)}>{l}</button>
      ))}
    </span>
  );
}

/** Wrap-around group of toggleable option cards. */
export function OptionGroup({ children }: { children: ReactNode }) {
  return <div className="opts" data-slot="option-group">{children}</div>;
}
export function OptionButton({ pressed, icon, children, ...rest }: { pressed?: boolean; icon?: ReactNode; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" data-slot="option" className="opt" aria-pressed={pressed} {...rest}>{icon}{children}</button>;
}
