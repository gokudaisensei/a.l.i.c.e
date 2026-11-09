import type { Entry } from "../types";

export default {
  slug: "avatar", title: "Avatar", category: "Display", status: "stable",
  description: "A round initial for a person, and a square holder for an icon at the start of a row.",
  exports: ["Avatar", "IconTile"], files: ["avatar.tsx", "avatar.css"],
  examples: [
    { name: "avatar", title: "Avatar", description: "Tone 1 to 4 picks the colour; away greys it." },
    { name: "icon-tile", title: "Icon tile" },
  ],
  anatomy: [{ slot: "avatar", description: "The round initial; `data-away` is set when greyed." }, { slot: "icon-tile", description: "The square icon holder." }],
  a11y: { notes: ["Both are decorative: the name sits next to them as text. If an avatar stands alone, give it an aria-label.", "An away person is shown dimmer and also named as away in text elsewhere: colour is not the only signal."] },
  guidance: { do: ["Pair an avatar with the person's name."], dont: ["Don't use an avatar alone to identify someone."] },
  related: ["badge"],
} satisfies Entry;
