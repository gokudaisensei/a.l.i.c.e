import type { Entry } from "../types";

export default {
  slug: "loading", title: "Loading", category: "Feedback", status: "stable",
  description: "A calm waiting state: a softly breathing mark and a short line. Use it instead of a bare “Loading…”.",
  exports: ["Loading"], files: ["loading.tsx", "loading.css"],
  examples: [{ name: "basic", title: "Basic" }, { name: "custom-label", title: "Saying what is happening" }],
  anatomy: [{ slot: "loading", description: "The status region." }],
  a11y: { notes: ["It is a status region, so a screen reader announces the label.", "The breathing animation stops with reduced motion."] },
  guidance: { do: ["Say what is being waited for: “Reading your home…”."], dont: ["Don't use it for a wait with known progress (use Progress)."] },
  related: ["progress", "empty"],
} satisfies Entry;
