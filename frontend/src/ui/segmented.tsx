"use client";
import { useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { useIndicator } from "./use-indicator";
import { useSwipeSelect } from "./use-swipe-select";
import { haptic } from "./haptics";
import { cn } from "./cn";

export interface SegmentedProps<T extends string | number> extends Omit<ComponentProps<"span">, "onChange" | "children" | "role" | "aria-label"> {
  value: T;
  /** `[value, label]` pairs, in order. */
  items: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  /** Names the group for screen readers. */
  label?: string;
}

/**
 * Single-choice control. A thumb slides between segments on a spring, arrow keys move the choice
 * (roving tabindex, like a native radio group), and it behaves as a radiogroup for assistive tech.
 */
export function Segmented<T extends string | number>({ value, items, onChange, label, className, onKeyDown, ...rest }: SegmentedProps<T>) {
  const root = useRef<HTMLSpanElement>(null);
  const { box, ready } = useIndicator(root, "[aria-checked=true]", `${String(value)}|${items.length}`);
  const choose = (v: T) => { if (v !== value) haptic("select"); onChange(v); };
  const swipe = useSwipeSelect({ index: Math.max(0, items.findIndex(([k]) => k === value)), onIndex: (i) => choose(items[i][0]), itemSelector: "button" });

  const onKey = (e: KeyboardEvent) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, items.findIndex(([k]) => k === value));
    const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    choose(items[n][0]);
    requestAnimationFrame(() => root.current?.querySelectorAll<HTMLElement>("button")[n]?.focus());
  };

  return (
    <span ref={root} data-slot="segmented" className={cn("seg", className)} role="radiogroup" aria-label={label} {...rest} {...swipe} onKeyDown={(e) => { onKey(e); onKeyDown?.(e); }}>
      {box ? <span className={cn("seg-ind", ready && "ready")} aria-hidden="true" style={{ width: box.w, transform: `translateX(${box.x}px)` }} /> : null}
      {items.map(([k, l]) => (
        <button key={String(k)} type="button" role="radio" aria-checked={value === k} tabIndex={value === k || (!items.some(([x]) => x === value) && k === items[0][0]) ? 0 : -1} onClick={() => choose(k)}>{l}</button>
      ))}
    </span>
  );
}

/** Wrap-around group of option cards: several can be on at once (use `Segmented` for exactly one). */
export function OptionGroup({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("opts", className)} data-slot="option-group" {...rest} />;
}

/** One toggleable card in an `OptionGroup`. `pressed` is the selected state. */
export function OptionButton({ pressed, icon, className, children, onClick, ...rest }: Omit<ComponentProps<"button">, "type"> & {
  /** Whether it is selected. */
  pressed?: boolean;
  /** A leading element, usually an `Icon`. */
  icon?: ReactNode;
}) {
  return <button type="button" data-slot="option" className={cn("opt", className)} aria-pressed={pressed} onClick={(e) => { haptic("select"); onClick?.(e); }} {...rest}>{icon}{children}</button>;
}
