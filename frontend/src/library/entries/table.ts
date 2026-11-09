import type { Entry } from "../types";

export default {
  slug: "table", title: "Table", category: "Display", status: "stable",
  description: "A simple table that scrolls sideways when the screen is narrow, instead of squeezing its columns.",
  exports: ["Table"], files: ["table.tsx", "table.css"],
  examples: [{ name: "basic", title: "Basic" }, { name: "mono", title: "Code font", description: "mono is for ids, addresses and times." }],
  anatomy: [{ slot: "table", description: "The `<table>`. It sits inside a horizontally scrolling wrapper." }],
  a11y: { notes: ["It is a real table with header cells, so screen readers announce the column for each cell.", "The scrolling wrapper means nothing is cut off on a narrow screen.", "Keep tables for data that is genuinely tabular; for a few facts use KeyValue."] },
  guidance: { do: ["Keep headings short.", "Right-align nothing by default: left-aligned text reads best."], dont: ["Don't build a layout out of a table."] },
  related: ["lists"],
} satisfies Entry;
