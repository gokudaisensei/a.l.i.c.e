import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./icon";
import { StepButton } from "./button";
import { cn } from "./cn";

/**
 * Visible minus and plus beside a control you set by dragging. A gesture is never the only way to do something (Apple's
 * rule for custom gestures), and a drag is hard for some people: this is the twin that is always on screen.
 */
export function Nudge({ label, onMinus, onPlus, minusDisabled, plusDisabled, children = "or tap − / +", className, ...rest }: Omit<ComponentProps<"div">, "children" | "role" | "aria-label"> & {
  /** What is being changed, for the button names: "Floor lamp brightness" gives "Lower Floor lamp brightness". */
  label: string;
  /** Called by the minus button. */
  onMinus: () => void;
  /** Called by the plus button. */
  onPlus: () => void;
  /** Greys the minus button (at the lowest value). */
  minusDisabled?: boolean;
  /** Greys the plus button (at the highest value). */
  plusDisabled?: boolean;
  /** A short line between the buttons. Hidden at large text sizes, where there is no room for it. */
  children?: ReactNode;
}) {
  return (
    <div data-slot="nudge" role="group" aria-label={label} className={cn("nudge", className)} {...rest}>
      <StepButton haptic="light" disabled={minusDisabled} onClick={onMinus} aria-label={`Lower ${label}`}><Icon n="minus" /></StepButton>
      <small>{children}</small>
      <StepButton haptic="light" disabled={plusDisabled} onClick={onPlus} aria-label={`Raise ${label}`}><Icon n="plus" /></StepButton>
    </div>
  );
}
