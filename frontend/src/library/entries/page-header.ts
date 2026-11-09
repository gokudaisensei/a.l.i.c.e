import type { Entry } from "../types";

export default {
  slug: "page-header", title: "Page header", category: "Navigation and layout", status: "stable",
  description: "The title of a page: the one h1, with an optional line under it.",
  exports: ["PageHeader"], files: ["page-header.tsx", "page-header.css"],
  examples: [{ name: "basic", title: "Basic" }],
  anatomy: [{ slot: "page-header", description: "The block." }],
  a11y: { notes: ["Renders the page's only h1: use it once per page.", "On a phone the line under the title is hidden to save space, so never put anything essential in it."] },
  guidance: { do: ["Use one per page."], dont: ["Don't put actions in the sentence under the title."] },
  related: ["tile"],
} satisfies Entry;
