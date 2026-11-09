import type { Entry } from "../types";

export default {
  slug: "segmented", title: "Segmented", category: "Inputs", status: "stable",
  description: "A choice of exactly one among a few options, with a thumb that slides between them. OptionGroup is its cousin for options that can be combined.",
  exports: ["Segmented", "OptionGroup", "OptionButton"], files: ["segmented.tsx", "segmented.css", "use-indicator.ts"],
  examples: [
    { name: "basic", title: "Basic", description: "Values can be strings or numbers; items are `[value, label]` pairs." },
    { name: "full-width", title: "Full width", description: "Stretches to fill a sheet or card." },
    { name: "option-group", title: "Option group", description: "Several can be on at once: each card is a toggle." },
  ],
  anatomy: [{ slot: "segmented", description: "The radio group." }, { slot: "option-group", description: "The wrapping group of option cards." }, { slot: "option", description: "One option card; `aria-pressed` is the state." }],
  gestures: [
    { gesture: "Tap", does: "Chooses the segment.", haptic: "select" },
    { gesture: "Swipe across", does: "Slide over the segments and the one under the finger is chosen as it passes; a tap that follows is ignored.", haptic: "select on each change" },
    { gesture: "Arrow keys, Home, End", does: "Move the choice.", haptic: "select" },
  ],
  a11y: {
    notes: ["Segmented is a radiogroup with roving tab index: one tab stop, arrow keys move the choice, like a native radio group.", "At larger text sizes the thumb gives way to a plain highlight and the segments wrap, so nothing is cut off.", "OptionButton exposes aria-pressed."],
    keyboard: [["Arrow keys", "Move the choice to the next or previous segment."], ["Home / End", "Jump to the first or last segment."], ["Tab", "Moves into and out of the group."]],
  },
  guidance: { do: ["Keep labels short, two to five options.", "Name the group with `label`."], dont: ["Don't use it for navigation between pages (use Tabs).", "Don't use more than five options (use Select)."] },
  related: ["tabs", "select", "checkbox"],
} satisfies Entry;
