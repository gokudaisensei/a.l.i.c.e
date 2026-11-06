import type { ReactNode } from "react";
import { Icon } from "./icon";
import { IconButton } from "./button";
import { Tooltip } from "./floating";

/**
 * One step in a list of things to do: a verb ("Turn on") followed by the controls that finish it (a device picker, a
 * number), with a remove button at the end. Used by the automation, scene and routine builders.
 */
export function ActionRow({ icon, verb, onRemove, children }: { icon: string; verb: string; onRemove?: () => void; children?: ReactNode }) {
  return (
    <div data-slot="action-row" className="arow">
      <span className="verb"><Icon n={icon} />{verb}</span>
      {children}
      {onRemove ? <Tooltip label="Remove this action"><IconButton style={{ marginLeft: "auto" }} aria-label={`Remove: ${verb}`} onClick={onRemove}><Icon n="trash" /></IconButton></Tooltip> : null}
    </div>
  );
}
