"use client";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "./cn";

export interface SwitchProps {
  checked: boolean;
  /** Accessible name. Required because the switch has no visible text. */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** On/off switch. The thumb stretches while pressed and settles with a light spring. */
export function Switch({ checked, label, onChange, disabled, className }: SwitchProps) {
  return (
    <BaseSwitch.Root data-slot="switch" className={cn("sw", className)} checked={checked} disabled={disabled} aria-label={label} onCheckedChange={(v) => onChange(v)}>
      <BaseSwitch.Thumb className="sw-t" />
    </BaseSwitch.Root>
  );
}
