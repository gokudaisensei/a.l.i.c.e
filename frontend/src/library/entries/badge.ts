import type { Entry } from "../types";

export default {
  slug: "badge", title: "Badge", category: "Display", status: "stable",
  description: "Small labels: Pill for a status, Chip for a fact on the hero, FilterChip for a filter with a count, and Eyebrow for the small caps line above a title.",
  exports: ["Pill", "Chip", "FilterChip", "Eyebrow"], files: ["badge.tsx", "badge.css"],
  examples: [
    { name: "pill", title: "Pill", description: "Tone says what the status means. Always say it in words too: colour alone is not a signal." },
    { name: "chip", title: "Chip", description: "A fact on the hero. A button when given onClick, otherwise inert text. A long name ends in an ellipsis." },
    { name: "filter-chip", title: "Filter chip", description: "A toggle with an optional count: the room filters." },
    { name: "eyebrow", title: "Eyebrow" },
  ],
  anatomy: [{ slot: "pill", description: "The status label. `data-tone` holds the tone." }, { slot: "chip", description: "The hero chip. `data-warn` is set when it is outlined." }, { slot: "filter-chip", description: "The filter toggle; `aria-pressed` is its state." }, { slot: "eyebrow", description: "The small caps line." }],
  gestures: [
    { gesture: "Tap a filter chip", does: "Toggles the filter.", haptic: "select" },
    { gesture: "Tap an actionable chip", does: "Runs its action." },
  ],
  a11y: { notes: ["Pill is plain text with an optional icon: it carries meaning in words, and its colour only reinforces it.", "A Chip without onClick is skipped by Tab, because it is not interactive.", "FilterChip exposes aria-pressed; the count is part of its text."] },
  guidance: { do: ["Say the status in words: “Unlocked”, not just a coloured dot."], dont: ["Don't use a Pill as a button.", "Don't rely on tone alone to carry meaning."] },
  related: ["notice", "avatar"],
} satisfies Entry;
