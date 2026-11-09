import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/** Checklist-style list of reassurances. `muted` rows use a cross. */
export function Safe({ items, className, ...rest }: Omit<ComponentProps<"div">, "children"> & {
  /** Each line, as plain text or `{ text, muted, icon }`. `muted` shows a cross: something Alice does not do. */
  items: (string | { text: string; muted?: boolean; icon?: string })[];
}) {
  return (
    <div data-slot="safe" className={cn("safe", className)} {...rest}>{items.map((it) => {
      const o = typeof it === "string" ? { text: it, muted: false } : { muted: false, ...it };
      return <div key={o.text} className={o.muted ? "muted" : undefined}><Icon n={o.icon ?? (o.muted ? "x" : "check")} /><span>{o.text}</span></div>;
    })}</div>
  );
}

/** Key and value rows. */
export function KeyValue({ rows, className, ...rest }: Omit<ComponentProps<"div">, "children"> & {
  /** `[key, value]` pairs, in order. */
  rows: [ReactNode, ReactNode][];
}) {
  return <div data-slot="key-value" className={cn("kv", className)} {...rest}>{rows.map(([k, v], i) => <div key={i}><span>{k}</span><span>{v}</span></div>)}</div>;
}

/** Step list for multi-stage jobs. `current` is the active step index. */
export function Steps({ steps, current, className, ...rest }: Omit<ComponentProps<"div">, "children"> & {
  /** The names of the steps, in order. */
  steps: string[];
  /** Index of the step in progress: earlier ones are done, later ones wait. */
  current: number;
}) {
  return (
    <div data-slot="steps" className={cn("steps", className)} {...rest}>{steps.map((s, i) => (
      <div key={s} className={cn("stp", i < current ? "done" : i === current && "on")} aria-current={i === current ? "step" : undefined}>
        <Icon n={i < current ? "check" : i === current ? "refresh" : "clock"} c={i === current ? "spin" : ""} />{s}
      </div>
    ))}</div>
  );
}
