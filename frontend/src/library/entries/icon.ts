import type { Entry } from "../types";

export default {
  slug: "icon", title: "Icon", category: "Utilities", status: "stable",
  description: "One icon set on a 24 px grid with a 1.7 stroke and round caps. Decorative by default; solid forms exist for the selected tab.",
  exports: ["Icon", "ICON_PATHS"], files: ["icon.tsx", "icon-paths.ts"],
  examples: [
    { name: "sizes", title: "Sizes", description: "20 px by default, sm 16 px, lg 26 px." },
    { name: "filled", title: "Filled", description: "A solid form for the selected state; the rest stay outlines." },
    { name: "labelled", title: "With a name", description: "An icon on its own needs a name: pass title and it becomes an image." },
  ],
  anatomy: [{ slot: "icon", description: "The SVG. `data-icon` holds its name." }],
  a11y: { notes: ["An icon is decorative by default (aria-hidden): it sits next to text that says the same thing.", "An icon that stands alone must be named: pass `title`, or put it in a button with an aria-label.", "Don't use an icon alone to carry meaning; pair it with a word."] },
  guidance: { do: ["Use one icon per meaning, everywhere."], dont: ["Don't mix in icons from another set: weight and shapes will clash."] },
  related: ["button", "badge"],
} satisfies Entry;
