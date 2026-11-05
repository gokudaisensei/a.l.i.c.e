import { cn } from "./cn";

export interface SwitchProps {
  checked: boolean;
  /** Accessible name. Required because the switch has no visible text. */
  label: string;
  onChange: (next: boolean) => void;
  className?: string;
}

export function Switch({ checked, label, onChange, className }: SwitchProps) {
  return <button type="button" className={cn("sw", className)} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />;
}
