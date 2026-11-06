import type { ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/** One option in a household-mode picker. `pressed` marks the active mode. */
export function ModeButton({ icon, label, description, pressed, onClick }: { icon: string; label: string; description?: ReactNode; pressed: boolean; onClick: () => void }) {
  return (
    <button data-slot="mode-button" className="mode" aria-pressed={pressed} onClick={onClick}>
      <Icon n={icon} /><b>{label}</b>{description ? <small>{description}</small> : null}
    </button>
  );
}

/** Scene or routine card. `suggested` outlines it in sage. */
export function SceneCard({ icon, name, description, tag, suggested, title, onClick }: { icon: string; name: string; description?: ReactNode; tag?: ReactNode; suggested?: boolean; title?: string; onClick: () => void }) {
  return (
    <button data-slot="scene-card" className={cn("scene", suggested && "rec")} title={title} onClick={onClick}>
      <Icon n={icon} /><b>{name}</b>{description ? <small>{description}</small> : null}{tag ? <span className="eyebrow">{tag}</span> : null}
    </button>
  );
}
