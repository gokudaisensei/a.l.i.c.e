import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";
import type { Tone } from "./badge";

/** An inline message that stays on the page: something to know (info), something done (ok), or something to fix (warn, announced to screen readers). */
export function Notice({ tone = "info", icon, children, action, className, ...rest }: Omit<ComponentProps<"div">, "children"> & {
  /** `warn` is something to fix (announced at once); `ok` confirms; `info` is for your information. */
  tone?: Tone;
  /** Replaces the icon the tone would pick. */
  icon?: string;
  children: ReactNode;
  /** An optional button at the end. */
  action?: ReactNode;
}) {
  return (
    <div data-slot="notice" data-tone={tone} role={tone === "warn" ? "alert" : "status"} className={cn("notice", `notice--${tone}`, className)} {...rest}>
      <Icon n={icon ?? (tone === "warn" ? "alert" : tone === "ok" ? "check" : "sparkle")} />
      <span className="notice-t">{children}</span>
      {action}
    </div>
  );
}
