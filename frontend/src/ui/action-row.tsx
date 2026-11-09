import type { ComponentProps } from "react";
import { Icon } from "./icon";
import { IconButton } from "./button";
import { Tooltip } from "./floating";
import { cn } from "./cn";

/**
 * One step in a list of things to do: a verb ("Turn on") followed by the controls that finish it (a device picker, a
 * number), with a remove button at the end. Used by the automation, scene and routine builders.
 */
export function ActionRow({ icon, verb, onRemove, className, children, ...rest }: ComponentProps<"div"> & {
  icon: string;
  /** What the step does: "Turn on", "Dim". */
  verb: string;
  /** Shows a remove button when given. */
  onRemove?: () => void;
}) {
  return (
    <div data-slot="action-row" className={cn("arow", className)} {...rest}>
      <span className="verb"><Icon n={icon} />{verb}</span>
      {children}
      {onRemove ? <Tooltip label="Remove this action"><IconButton className="arow-x" aria-label={`Remove: ${verb}`} onClick={onRemove}><Icon n="trash" /></IconButton></Tooltip> : null}
    </div>
  );
}
