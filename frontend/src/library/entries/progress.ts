import type { Entry } from "../types";

export default {
  slug: "progress", title: "Progress", category: "Display", status: "stable",
  description: "A bar that shows how far along something is, or how close a reading is to its limit. The fill glides to a new value.",
  exports: ["Progress", "Bar"], files: ["progress.tsx", "progress.css"],
  examples: [
    { name: "basic", title: "Basic", description: "Bar takes a percentage; Progress takes a value and a maximum." },
    { name: "warn", title: "Near a limit", description: "warn turns the fill clay when a reading is close to its limit." },
  ],
  anatomy: [{ slot: "progress", description: "The track. The fill is its only child." }],
  a11y: { notes: ["Exposed as role=\"progressbar\" with its value and maximum; the label says what is progressing.", "The warn state is also stated in words next to the bar, not by colour alone."] },
  guidance: { do: ["Label it: “Backup progress”, “Power use”.", "Show the number or a sentence beside it."], dont: ["Don't use for an unknown wait (use Loading)."] },
  related: ["loading", "sparkline"],
} satisfies Entry;
