import type { ComponentProps } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/** Door tile for a dark surface. Amber when the door is open. */
export function LockTile({ icon, name, status, locked, hint, className, ...rest }: Omit<ComponentProps<"button">, "children" | "type"> & {
  icon: string;
  /** The door's name. */
  name: string;
  /** What state it is in, in words: "Locked", "Open · tap to lock". */
  status: string;
  /** Whether the door is locked. Unlocked shows amber. */
  locked: boolean;
  /** What a tap does, read after the name and state (hidden from sight): "Tap to unlock." */
  hint?: string;
}) {
  return (
    <button type="button" data-slot="lock-tile" data-locked={locked ? "" : undefined} className={cn("lkb", !locked && "open", className)} {...rest}>
      <span className="lk"><Icon n={icon} /></span><span><b>{name}</b><small>{status}</small></span>
      {hint ? <span className="sr">{hint}</span> : null}
    </button>
  );
}
