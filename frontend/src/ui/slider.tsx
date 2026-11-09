"use client";
import { useRef, type ComponentProps } from "react";
import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cn } from "./cn";
import { haptic } from "./haptics";
import { useDoubleTap } from "./use-double-tap";

export interface SliderProps extends Omit<ComponentProps<typeof BaseSlider.Root>, "value" | "defaultValue" | "onChange" | "onValueChange" | "onValueCommitted" | "min" | "max" | "disabled" | "className" | "children" | "aria-label"> {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  /** `md` is the thin bar; `xl` is the tall full-width bar for sheets. */
  size?: "md" | "xl";
  disabled?: boolean;
  className?: string;
  /** Words for a value, for screen readers and for `showValue`: `(v) => `${v}%``. Defaults to the bare number. */
  valueText?: (value: number) => string;
  /** Shows the value beside the bar as live feedback while it is dragged. */
  showValue?: boolean;
  /** Double-tap the bar to return to this value (a default, such as full brightness). Leave it out for no reset. */
  resetValue?: number;
}

/**
 * Filled slider built from real elements, so the fill glides when a value jumps (a preset tap)
 * and the thumb lifts while it is dragged. It opts out of the bottom sheet's swipe-to-dismiss.
 */
export function Slider({ value, onChange, label, min = 1, max = 100, size = "md", disabled, className, valueText, showValue, resetValue, ...rest }: SliderProps) {
  const last = useRef(value);
  const reset = useDoubleTap(() => { if (resetValue !== undefined) { haptic("medium"); onChange(resetValue); } });
  // what dragging feels like: a tick every twentieth, a click at each quarter, a bump at either end
  const feel = (n: number) => {
    const prev = last.current; last.current = n;
    if (n === prev) return;
    if (n <= min || n >= max) { if (prev > min && prev < max) haptic("boundary"); return; }
    const zone = (x: number, parts: number) => Math.floor(((x - min) / (max - min)) * parts);
    if (zone(n, 4) !== zone(prev, 4)) haptic("detent"); else if (zone(n, 20) !== zone(prev, 20)) haptic("tick");
  };
  const bar = (
    <BaseSlider.Root data-slot="slider" data-size={size} data-base-ui-swipe-ignore className={cn("rng", className)} value={value} min={min} max={max} disabled={disabled}
      onValueChange={(v) => { const n = Array.isArray(v) ? v[0] : v; feel(n); onChange(n); }} {...(resetValue !== undefined ? reset : {})} {...rest}>
      <BaseSlider.Control className="rng-c">
        <BaseSlider.Track className="rng-t">
          <BaseSlider.Indicator className="rng-i" />
          <BaseSlider.Thumb className="rng-th" aria-label={label} getAriaValueText={valueText ? (_, v) => valueText(v) : undefined} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
  if (!showValue) return bar;
  return <div data-slot="slider-field" className="rng-row">{bar}<output className="rng-v num" aria-hidden="true">{valueText ? valueText(value) : value}</output></div>;
}
