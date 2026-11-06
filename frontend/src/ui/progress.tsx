"use client";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { cn } from "./cn";

/** Determinate progress bar. The fill glides to a new value. Exposes `role="progressbar"` to assistive tech. */
export function Progress({ value, max = 100, label = "Progress", warn, className }: { value: number; max?: number; label?: string; warn?: boolean; className?: string }) {
  return (
    <BaseProgress.Root data-slot="progress" className={cn("bar", warn && "warn", className)} value={Math.max(0, Math.min(max, value))} max={max} aria-label={label}>
      <BaseProgress.Indicator render={<i />} />
    </BaseProgress.Root>
  );
}
