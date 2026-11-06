import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  /** 24-hour "HH:MM". */
  value: string;
  onChange: (next: string) => void;
  /** Names the field for screen readers, e.g. "Backup time". */
  label: string;
};

/** A time of day. Uses the device's own time picker, so it is native on phones. */
export function TimeField({ value, onChange, label, className, ...rest }: Props) {
  return <input data-slot="time-field" type="time" className={cn("inp time-field", className)} aria-label={label} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} {...rest} />;
}
