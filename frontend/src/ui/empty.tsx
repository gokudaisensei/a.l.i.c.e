import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** What to show when there is nothing yet. It is temporary: say what to do next, and give the action if there is one. */
export function Empty({ action, className, children, ...rest }: ComponentProps<"div"> & {
  /** The next step, usually a Button: an empty state is a signpost, not a dead end. */
  action?: ReactNode;
}) {
  return <div data-slot="empty" className={cn("empty", className)} {...rest}>{children}{action ? <div className="empty-a">{action}</div> : null}</div>;
}
