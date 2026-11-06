"use client";
import { Slider as BaseSlider } from "@base-ui/react/slider";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  size?: "md" | "xl";
  disabled?: boolean;
}

/**
 * Filled slider built from real elements, so the fill glides when a value jumps (a preset tap)
 * and the thumb lifts while it is dragged. It opts out of the bottom sheet's swipe-to-dismiss.
 */
export function Slider({ value, onChange, label, min = 1, max = 100, size = "md", disabled }: SliderProps) {
  return (
    <BaseSlider.Root data-slot="slider" data-size={size} data-base-ui-swipe-ignore className="rng" value={value} min={min} max={max} disabled={disabled}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}>
      <BaseSlider.Control className="rng-c">
        <BaseSlider.Track className="rng-t">
          <BaseSlider.Indicator className="rng-i" />
          <BaseSlider.Thumb className="rng-th" aria-label={label} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
