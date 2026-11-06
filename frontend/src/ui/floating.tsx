"use client";
import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Popover as BasePopover } from "@base-ui/react/popover";

type Side = "top" | "bottom" | "left" | "right";

/** Wrap a region once so neighbouring tooltips open instantly after the first one. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={450} closeDelay={80}>{children}</BaseTooltip.Provider>;
}

/** Short label for an icon button. Shows on hover and keyboard focus; never on touch. */
export function Tooltip({ label, side = "top", children }: { label: ReactNode; side?: Side; children: ReactElement }) {
  return (
    <BaseTooltip.Provider delay={450} closeDelay={80}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={children} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner className="pos" side={side} sideOffset={8}>
            <BaseTooltip.Popup data-slot="tooltip" className="tip">{label}</BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

/** Small floating panel anchored to its trigger. Focus moves in on open and back out on close. */
export function Popover({ trigger, title, side = "bottom", align = "center", children }: { trigger: ReactElement; title?: ReactNode; side?: Side; align?: "start" | "center" | "end"; children: ReactNode }) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className="pos" side={side} align={align} sideOffset={8}>
          <BasePopover.Popup data-slot="popover" className="float pop">
            {title ? <BasePopover.Title className="pop-t">{title}</BasePopover.Title> : null}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

/** Put on any control inside a Popover that should close it. */
export const PopoverClose = BasePopover.Close;
