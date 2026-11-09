import type { Entry } from "../types";

export default {
  slug: "lists", title: "Lists", category: "Display", status: "stable",
  description: "Three small list patterns: KeyValue for facts, Steps for a job with stages, and Safe for a checklist of reassurances.",
  exports: ["KeyValue", "Steps", "Safe"], files: ["lists.tsx", "lists.css"],
  examples: [
    { name: "key-value", title: "Key and value" },
    { name: "steps", title: "Steps", description: "Earlier steps are done, the current one spins, later ones wait." },
    { name: "safe", title: "Safe", description: "A muted row shows a cross: something Alice does not do." },
  ],
  anatomy: [{ slot: "key-value", description: "The rows." }, { slot: "steps", description: "The step list. The current step has aria-current=\"step\"." }, { slot: "safe", description: "The checklist." }],
  a11y: { notes: ["Steps marks the current step with aria-current=\"step\"; the done and waiting states are shown by icon and text colour, and the names stay readable.", "KeyValue is plain text in rows: values wrap rather than overflow."] },
  guidance: { do: ["Keep Safe lines short and plain.", "Use Steps for jobs that take a few seconds or more."], dont: ["Don't use KeyValue for tabular data with many columns (use Table)."] },
  related: ["table", "notice"],
} satisfies Entry;
