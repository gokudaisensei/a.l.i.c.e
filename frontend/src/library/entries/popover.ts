import type { Entry } from "../types";

export default {
  slug: "popover", title: "Popover", category: "Overlays", status: "stable",
  description: "A small panel anchored to the control that opened it, for a little more than a tooltip can hold: a short explanation, or one or two actions.",
  exports: ["Popover", "PopoverClose"], files: ["floating.tsx", "floating.css"],
  examples: [{ name: "basic", title: "Basic", height: 260 }],
  anatomy: [{ slot: "popover", description: "The panel. It is a glass surface." }],
  gestures: [
    { gesture: "Tap the trigger", does: "Opens; focus moves in." },
    { gesture: "Escape or tap outside", does: "Closes." },
  ],
  a11y: { notes: ["Focus moves into the panel when it opens and back to the trigger when it closes; Escape closes it.", "title names the panel for screen readers.", "Put PopoverClose on any control that should close it."], keyboard: [["Enter / Space", "Opens it from the trigger."], ["Escape", "Closes it."]] },
  guidance: { do: ["Use for secondary detail or one or two actions."], dont: ["Don't put forms or long content in it (use a sheet)."] },
  related: ["tooltip", "modal"],
} satisfies Entry;
