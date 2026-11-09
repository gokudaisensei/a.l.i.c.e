import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** A label and its control, on one line (wrapping when narrow). The label is the control's accessible name. */
export function Field({ label, children, minLabel, className, ...rest }: Omit<ComponentProps<"label">, "children"> & {
  label?: string;
  children: ReactNode;
  /** Minimum width of the label in px, to line several fields up. */
  minLabel?: number;
}) {
  return (
    <label data-slot="field" className={cn("field", className)} {...rest}>
      {label ? <span className="small" style={minLabel ? { minWidth: minLabel } : undefined}>{label}</span> : null}
      {children}
    </label>
  );
}

/** Wrapper for several fields that sit on one row. */
export function FieldRow({ className, ...rest }: ComponentProps<"div">) { return <div data-slot="field-row" className={cn("field", className)} {...rest} />; }

/** Text input. Size classes: `inp--sm`, `inp--code`, `inp--fill`, `inp--mono`. Always give it a label (a `Field` around it, or `aria-label`). */
export function Input({ className, ...rest }: ComponentProps<"input">) { return <input data-slot="input" className={cn("inp", className)} {...rest} />; }

/** Multi-line text input. Same size classes as `Input`. */
export function Textarea({ className, ...rest }: ComponentProps<"textarea">) { return <textarea data-slot="textarea" className={cn("inp", className)} {...rest} />; }
