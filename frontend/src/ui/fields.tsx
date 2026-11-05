import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/** Inline label + control. */
export function Field({ label, children, minLabel }: { label?: string; children: ReactNode; minLabel?: number }) {
  return (
    <label className="field">
      {label ? <span className="small" style={minLabel ? { minWidth: minLabel } : undefined}>{label}</span> : null}
      {children}
    </label>
  );
}
/** Wrapper for several fields that sit on one row. */
export function FieldRow({ children }: { children: ReactNode }) { return <div className="field">{children}</div>; }

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn("inp", className)} {...rest} />; }
export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cn("inp", className)} {...rest} />; }
export function Select({ options, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { options: readonly (readonly [string, string])[] }) {
  return <select className={cn("sel", className)} {...rest}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>;
}
