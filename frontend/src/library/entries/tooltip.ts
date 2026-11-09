import type { Entry } from "../types";

export default {
  slug: "tooltip", title: "Tooltip", category: "Overlays", status: "stable",
  description: "A short label for an icon button, shown on hover and keyboard focus. Never shown on touch, so it can only repeat what the control already says.",
  exports: ["Tooltip", "TooltipProvider"], files: ["floating.tsx", "floating.css"],
  examples: [{ name: "basic", title: "Basic", height: 130 }],
  anatomy: [{ slot: "tooltip", description: "The popup." }],
  gestures: [
    { gesture: "Hover or focus", does: "Shows after a short delay; never shown on touch." },
  ],
  a11y: { notes: ["The trigger must carry its own accessible name: the tooltip repeats it for sighted mouse and keyboard users, it does not replace it.", "It opens on hover after a short delay and on keyboard focus; neighbouring tooltips open at once after the first.", "Touch devices never show it, so never hide essential information in one."] },
  guidance: { do: ["Keep it to a few words."], dont: ["Don't put links, buttons or long text in it (use Popover)."] },
  related: ["popover", "button"],
} satisfies Entry;
