import type { Entry } from "../types";

export default {
  slug: "tile", title: "Tile", category: "Navigation and layout", status: "stable",
  description: "A card on the home grid, sized in columns and rows and tinted by tone. On a phone, inside an AccordionContext, tiles collapse to a header.",
  exports: ["Tile", "TileHeader", "Grid", "AccordionContext"], files: ["tile.tsx", "tile.css"],
  examples: [
    { name: "grid", title: "A grid of tiles", description: "Columns are spans on a 12-column grid; the numbers adapt to the screen." },
    { name: "accordion", title: "Collapsible on a phone", description: "The library holds no state: you provide isOpen and toggle. Resize to Phone to see it.", height: 360, },
  ],
  anatomy: [{ slot: "tile", description: "The card. `aacc` and `open` classes track accordion state." }, { slot: "grid", description: "The 12-column grid." }],
  gestures: [
    { gesture: "Tap a collapsible header", does: "Opens or closes it (on a phone, inside an AccordionContext).", haptic: "select" },
  ],
  a11y: { notes: ["In an accordion the header is a button with Enter and Space handling; the open state follows your isOpen.", "Tiles fade in as a page changes; this stops with reduced motion."], keyboard: [["Enter / Space", "Opens or closes a collapsible tile header."]] },
  guidance: { do: ["Give each tile one clear job.", "Use tone sparingly: one accent per area."], dont: ["Don't nest tiles in tiles."] },
  related: ["page-header", "device-tile"],
} satisfies Entry;
