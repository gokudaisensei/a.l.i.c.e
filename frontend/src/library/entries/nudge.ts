import type { Entry } from "../types";

export default {
  slug: "nudge", title: "Nudge", category: "Inputs", status: "new",
  description: "Visible minus and plus beside a control you set by dragging. A gesture is never the only way to do something, and a drag is hard for some people: this is the twin that is always on screen.",
  exports: ["Nudge"], files: ["nudge.tsx", "nudge.css", "button.tsx"],
  examples: [
    { name: "with-slider", title: "Beside a slider", description: "Each tap is one step; the buttons grey at the ends." },
    { name: "with-dial", title: "Beside a dial", description: "The dial is the quick way, the buttons the exact way." },
  ],
  anatomy: [{ slot: "nudge", description: "The group holding both buttons and the line between them." }],
  gestures: [
    { gesture: "Tap minus or plus", does: "One step.", haptic: "light" },
  ],
  a11y: {
    notes: ["A labelled group; each button says what it does (“Lower Floor lamp brightness”), so a screen reader hears the control, not just a sign.", "The buttons are the keyboard and switch-control path for a drag control, and they meet the 44 pt touch size.", "The line between them is a hint for sighted users and is hidden at large text sizes, where there is no room."],
  },
  guidance: { do: ["Put one beside every slider, dial, wheel or shade.", "Name what is being changed."], dont: ["Don't use it alone for a wide range: it is for fine steps beside a faster control."] },
  related: ["slider", "dial", "stepper"],
} satisfies Entry;
