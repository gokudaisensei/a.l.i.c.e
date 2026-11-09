"use client";
import type { ComponentProps, ReactNode } from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Icon } from "./icon";
import { haptic } from "./haptics";
import { cn } from "./cn";

export interface CheckboxProps extends Omit<ComponentProps<typeof BaseCheckbox.Root>, "checked" | "defaultChecked" | "onCheckedChange" | "className" | "children" | "aria-label" | "disabled" | "indeterminate"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label. Without it, pass `label` for screen readers. */
  children?: ReactNode;
  label?: string;
  /** Shows a dash instead of a tick: some, but not all, of what it covers is selected. */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Tick box. With children it renders a tappable row, so the whole label toggles it. */
export function Checkbox({ checked, onChange, children, label, indeterminate, disabled, className, ...rest }: CheckboxProps) {
  const box = (
    <BaseCheckbox.Root data-slot="checkbox" {...rest} className={cn("cbx", !children && className)} checked={checked} indeterminate={indeterminate} disabled={disabled} aria-label={children ? undefined : label} onCheckedChange={(v) => { haptic(v ? "toggleOn" : "toggleOff"); onChange(v); }}>
      <BaseCheckbox.Indicator className="cbx-i" keepMounted><Icon n={indeterminate ? "minus" : "check"} c="sm" /></BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
  return children ? <label className={cn("cbx-row", className)}>{box}<span>{children}</span></label> : box;
}
