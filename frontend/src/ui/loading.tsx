import type { ComponentProps } from "react";
import { cn } from "./cn";

/** Calm waiting state: a softly breathing mark and a short line. Use instead of bare "Loading…" text. */
export function Loading({ label = "Loading…", className, ...rest }: Omit<ComponentProps<"div">, "children"> & {
  /** What is being waited for, in a few words. */
  label?: string;
}) {
  return (
    <div data-slot="loading" role="status" className={cn("loading", className)} {...rest}>
      <span className="loading-mark" aria-hidden="true"><i /></span>
      <span>{label}</span>
    </div>
  );
}
