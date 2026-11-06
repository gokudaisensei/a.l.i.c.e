import { Icon } from "./icon";
import { cn } from "./cn";

/** Door tile for a dark surface. Amber when the door is open. */
export function LockTile({ icon, name, status, locked, label, onClick }: { icon: string; name: string; status: string; locked: boolean; label: string; onClick: () => void }) {
  return (
    <button data-slot="lock-tile" className={cn("lkb", !locked && "open")} aria-label={label} onClick={onClick}>
      <span className="lk"><Icon n={icon} /></span><span><b>{name}</b><small>{status}</small></span>
    </button>
  );
}
