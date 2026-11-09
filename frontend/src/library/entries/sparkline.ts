import type { Entry } from "../types";

export default {
  slug: "sparkline", title: "Sparkline", category: "Display", status: "stable",
  description: "A small smooth area chart for a trend, such as power use through the day, with a dot at the latest value.",
  exports: ["Sparkline"], files: ["chart.tsx", "chart.css"],
  examples: [{ name: "basic", title: "Basic" }],
  anatomy: [{ slot: "sparkline", description: "The SVG. It is an image with a label." }],
  a11y: { notes: ["It is an image (role=\"img\") with an aria-label: put the takeaway in the label (“Power use today, peaking at 2 pm”), because the shape itself is not available to a screen reader.", "Always show the latest value as text next to it."] },
  guidance: { do: ["Show the current number beside it.", "Describe the trend in the label."], dont: ["Don't use it to compare precise values."] },
  related: ["progress"],
} satisfies Entry;
