import type { CSSProperties, ReactNode } from "react";

export interface SegmentedProps<T extends string | number> {
  value: T;
  items: readonly (readonly [T, ReactNode])[];
  onChange: (value: T) => void;
  label?: string;
  style?: CSSProperties;
}

/** Single-choice toggle group (a radio group that looks like a pill bar). */
export function Segmented<T extends string | number>({ value, items, onChange, label, style }: SegmentedProps<T>) {
  return (
    <span className="seg" role="group" aria-label={label} style={style}>
      {items.map(([k, l]) => <button key={String(k)} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </span>
  );
}

/** Wrap-around group of toggleable option cards. */
export function OptionGroup({ children }: { children: ReactNode }) {
  return <div className="opts">{children}</div>;
}
export function OptionButton({ pressed, icon, children, ...rest }: { pressed?: boolean; icon?: ReactNode; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="opt" aria-pressed={pressed} {...rest}>{icon}{children}</button>;
}
