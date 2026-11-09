import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/** One option in a household-mode picker. `pressed` marks the active mode. */
export function ModeButton({ icon, label, description, pressed, className, ...rest }: Omit<ComponentProps<"button">, "children" | "type"> & {
  icon: string;
  /** The mode's name. */
  label: string;
  /** A short line under the label. */
  description?: ReactNode;
  pressed: boolean;
}) {
  return (
    <button type="button" data-slot="mode-button" className={cn("mode", className)} aria-pressed={pressed} {...rest}>
      <Icon n={icon} /><b>{label}</b>{description ? <small>{description}</small> : null}
    </button>
  );
}

/** Scene or routine card. `suggested` outlines it in sage. */
export function SceneCard({ icon, name, description, tag, suggested, className, ...rest }: Omit<ComponentProps<"button">, "children" | "type"> & {
  icon: string;
  /** The scene's name. */
  name: string;
  /** What it does, in a short line. */
  description?: ReactNode;
  /** A small label at the bottom: "Routine", "Suggested". */
  tag?: ReactNode;
  /** Outlines the card: Alice suggests it for now. */
  suggested?: boolean;
}) {
  return (
    <button type="button" data-slot="scene-card" data-suggested={suggested ? "" : undefined} className={cn("scene", suggested && "rec", className)} {...rest}>
      <Icon n={icon} /><b>{name}</b>{description ? <small>{description}</small> : null}{tag ? <span className="eyebrow">{tag}</span> : null}
    </button>
  );
}
