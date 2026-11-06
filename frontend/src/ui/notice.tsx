import type { ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";
import type { Tone } from "./badge";

/** An inline message that stays on the page: something to know, or something to fix. `action` is an optional button. */
export function Notice({ tone = "info", icon, children, action }: { tone?: Tone; icon?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div data-slot="notice" role={tone === "warn" ? "alert" : "status"} className={cn("notice", `notice--${tone}`)}>
      <Icon n={icon ?? (tone === "warn" ? "alert" : tone === "ok" ? "check" : "sparkle")} />
      <span className="notice-t">{children}</span>
      {action}
    </div>
  );
}
