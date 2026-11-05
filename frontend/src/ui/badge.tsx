import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

export type Tone = "neutral" | "ok" | "warn" | "info";

/** Small status label with an optional leading icon. */
export function Pill({ tone = "neutral", icon, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: string; children?: ReactNode }) {
  return <span className={cn("pill", tone !== "neutral" && tone, className)} {...rest}>{icon ? <Icon n={icon} c="sm" /> : null}{children}</span>;
}

/** Hero chip. Clickable when given `onClick`, otherwise inert. */
export function Chip({ icon, warn, onClick, children }: { icon: string; warn?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn("chip", warn && "warn")} {...(onClick ? { onClick } : { tabIndex: -1 })}>
      <Icon n={icon} />{children}
    </button>
  );
}

/** Filter chip with a count, used for room filters. */
export function FilterChip({ pressed, count, icon, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean; count?: number; icon?: string }) {
  return (
    <button type="button" className="rchip" aria-pressed={pressed} {...rest}>
      {icon ? <Icon n={icon} c="sm" /> : null}{children}{count !== undefined ? <> <em>{count}</em></> : null}
    </button>
  );
}

/** Small uppercase mono label. */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("eyebrow", className)} {...rest} />;
}
