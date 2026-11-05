import type { CSSProperties } from "react";
import { cn } from "./cn";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  size?: "md" | "xl";
}

/** Filled range input. The fill is driven by the `--p` custom property. */
export function Slider({ value, onChange, label, min = 1, max = 100, size = "md" }: SliderProps) {
  const style = { "--p": `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
  return <input className={cn("rng", size === "xl" && "xl")} type="range" min={min} max={max} value={value} style={style} aria-label={label} onChange={(e) => onChange(+e.target.value)} />;
}
