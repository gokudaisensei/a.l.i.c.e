import { cn } from "./cn";

/** Calm waiting state: a softly breathing mark and a short line. Use instead of bare "Loading…" text. */
export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div data-slot="loading" role="status" className={cn("loading", className)}>
      <span className="loading-mark" aria-hidden="true"><i /></span>
      <span>{label}</span>
    </div>
  );
}
