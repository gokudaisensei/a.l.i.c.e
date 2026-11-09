import type { Entry } from "../types";

export default {
  slug: "switch", title: "Switch", category: "Inputs", status: "stable",
  description: "An on or off setting that takes effect at once. Use it in lists and settings; on a tile, the whole tile is the toggle.",
  exports: ["Switch"], files: ["switch.tsx", "switch.css"],
  examples: [
    { name: "basic", title: "Basic", description: "Controlled: you own the state. The label is the accessible name." },
    { name: "in-a-row", title: "In a list row", description: "The usual home: a label on the left and the switch at the end." },
    { name: "disabled", title: "Disabled" },
  ],
  anatomy: [{ slot: "switch", description: "The track. Base UI sets `data-checked`, `data-unchecked` and `data-disabled`." }],
  gestures: [
    { gesture: "Tap", does: "Toggles.", haptic: "toggleOn or toggleOff" },
    { gesture: "Drag the thumb", does: "The thumb follows the finger and lands on the side it is nearer to when released. A bump as it crosses the middle.", haptic: "detent, then toggleOn or toggleOff" },
    { gesture: "Space or Enter", does: "Toggles.", haptic: "toggleOn or toggleOff" },
  ],
  a11y: {
    notes: ["It is exposed as role=\"switch\" with its on or off state; the label prop is its name because it has no visible text.", "The state is shown by the thumb's position and the track colour, so it does not rely on colour alone.", "The thumb stretches while pressed and settles on a light spring; with reduced motion it does not."],
    keyboard: [["Space", "Toggles the switch."], ["Enter", "Toggles the switch."], ["Tab", "Moves focus to or away from it."]],
  },
  guidance: {
    do: ["Use it for a setting that applies the moment it flips.", "Label what it does when on: “Quiet hours”, not “Toggle”."],
    dont: ["Don't use it to start an action (use a button).", "Don't use it for a choice among several options (use Segmented)."],
  },
  related: ["checkbox", "segmented"],
} satisfies Entry;
