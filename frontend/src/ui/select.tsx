"use client";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Icon } from "./icon";
import { cn } from "./cn";

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  /** `[value, label]` pairs. */
  options: readonly (readonly [string, string])[];
  /** Accessible name when there is no visible label next to it. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Drop-down list. A real popup instead of the browser's native one, so it matches the rest of the UI,
 * opens and closes with a spring, and supports type-ahead and arrow keys. Touch opens it below the field.
 */
export function Select({ value, onChange, options, label, placeholder, disabled, className }: SelectProps) {
  const items = options.map(([v, l]) => ({ value: v, label: l }));
  return (
    <BaseSelect.Root items={items} value={value} disabled={disabled} onValueChange={(v) => { if (typeof v === "string") onChange(v); }}>
      <BaseSelect.Trigger data-slot="select" className={cn("sel sel-t", className)} aria-label={label}>
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="sel-i"><Icon n="chev" c="sm" /></BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="pos" sideOffset={6} alignItemWithTrigger={false}>
          <BaseSelect.Popup className="float sel-pop">
            <BaseSelect.List>
              {options.map(([v, l]) => (
                <BaseSelect.Item key={v} value={v} className="sel-item">
                  <BaseSelect.ItemText>{l}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="sel-check"><Icon n="check" c="sm" /></BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
