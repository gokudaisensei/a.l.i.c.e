import type { ComponentProps } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";
import { haptic } from "./haptics";

export type Tone = "neutral" | "ok" | "warn" | "info";

/** Small status label with an optional leading icon. Colour is never the only signal: say the status in words too. */
export function Pill({ tone = "neutral", icon, className, children, ...rest }: ComponentProps<"span"> & {
  /** Meaning of the colour: ok (done, safe), warn (needs a look), info (for your information). */
  tone?: Tone;
  /** Leading icon name. */
  icon?: string;
}) {
  return <span data-slot="pill" data-tone={tone} className={cn("pill", tone !== "neutral" && tone, className)} {...rest}>{icon ? <Icon n={icon} c="sm" /> : null}{children}</span>;
}

/** Status chip for the hero. A button when given `onClick`, otherwise inert text that is skipped by Tab. */
export function Chip({ icon, warn, onClick, className, children, ...rest }: Omit<ComponentProps<"button">, "type"> & {
  icon: string;
  /** Outlines the chip: something to look at. */
  warn?: boolean;
}) {
  return (
    <button type="button" data-slot="chip" data-warn={warn ? "" : undefined} className={cn("chip", warn && "warn", className)} {...(onClick ? { onClick } : { tabIndex: -1 })} {...rest}>
      <Icon n={icon} /><span className="chip-t">{children}</span>
    </button>
  );
}

/** Filter chip with an optional count, used for room filters. `pressed` is the selected state. */
export function FilterChip({ pressed, count, icon, className, children, onClick, ...rest }: Omit<ComponentProps<"button">, "type"> & {
  pressed: boolean;
  /** A number shown after the label. */
  count?: number;
  icon?: string;
}) {
  return (
    <button type="button" data-slot="filter-chip" className={cn("rchip", className)} aria-pressed={pressed} onClick={(e) => { haptic("select"); onClick?.(e); }} {...rest}>
      {icon ? <Icon n={icon} c="sm" /> : null}{children}{count !== undefined ? <> <em>{count}</em></> : null}
    </button>
  );
}

/** Small uppercase mono label that sits above a title. */
export function Eyebrow({ className, ...rest }: ComponentProps<"div">) {
  return <div data-slot="eyebrow" className={cn("eyebrow", className)} {...rest} />;
}
