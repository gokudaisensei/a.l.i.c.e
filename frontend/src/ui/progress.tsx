"use client";
import type { ComponentProps } from "react";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "./cn";

/** Determinate progress bar. The fill glides to a new value. Exposes `role="progressbar"` to assistive tech. */
export function Progress({ value, max = 100, label = "Progress", warn, className, ...rest }: Omit<ComponentProps<typeof BaseProgress.Root>, "value" | "max" | "className" | "children" | "aria-label"> & {
  value: number;
  max?: number;
  /** What is progressing, for screen readers. */
  label?: string;
  /** Turns the fill clay: close to a limit. */
  warn?: boolean;
  className?: string;
}) {
  return (
    <BaseProgress.Root data-slot="progress" className={cn("bar", warn && "warn", className)} value={Math.max(0, Math.min(max, value))} max={max} aria-label={label} {...rest}>
      <BaseProgress.Indicator render={<i />} />
    </BaseProgress.Root>
  );
}

/** Horizontal meter: a `Progress` that takes a percentage. `warn` turns it clay. */
export function Bar({ percent, warn, label, ...rest }: Omit<ComponentProps<typeof Progress>, "value" | "max"> & {
  /** How full the bar is, 0 to 100. */
  percent: number;
}) {
  return <Progress value={percent} warn={warn} label={label} {...rest} />;
}
