"use client";
import type { ReactNode } from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Icon } from "./icon";
import { cn } from "./cn";

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label. Without it, pass `label` for screen readers. */
  children?: ReactNode;
  label?: string;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Tick box. With children it renders a tappable row, so the whole label toggles it. */
export function Checkbox({ checked, onChange, children, label, indeterminate, disabled, className }: CheckboxProps) {
  const box = (
    <BaseCheckbox.Root data-slot="checkbox" className={cn("cbx", !children && className)} checked={checked} indeterminate={indeterminate} disabled={disabled} aria-label={children ? undefined : label} onCheckedChange={(v) => onChange(v)}>
      <BaseCheckbox.Indicator className="cbx-i" keepMounted><Icon n={indeterminate ? "minus" : "check"} c="sm" /></BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
  return children ? <label className={cn("cbx-row", className)}>{box}<span>{children}</span></label> : box;
}
