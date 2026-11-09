import type { Entry } from "../types";

export default {
  slug: "modal", title: "Modal", category: "Overlays", status: "stable",
  description: "A dialog that holds focus until it is dismissed, and ConfirmDialog, the passkey confirmation built on it. Use sparingly: most things can be undone instead.",
  exports: ["Modal", "ConfirmDialog"], files: ["overlay.tsx", "overlay.css", "glass.css"],
  examples: [
    { name: "basic", title: "Basic", height: 380 },
    { name: "destructive", title: "A destructive confirmation", description: "Red only for what cannot be undone. The cancel button keeps the word “Cancel”, and the title says what is about to happen.", height: 420 },
    { name: "confirm", title: "Passkey confirmation", description: "For sensitive actions such as unlocking a door. The dialog shows each state of the prompt.", height: 420 },
  ],
  anatomy: [{ slot: "scrim", description: "The dimmed, blurred backdrop." }, { slot: "modal", description: "The dialog surface." }],
  gestures: [
    { gesture: "Escape or tap outside", does: "Dismisses." },
    { gesture: "Passkey prompt", does: "Opening the prompt and its success are felt.", haptic: "light, success" },
  ],
  a11y: { notes: ["Focus moves in when it opens, is trapped inside, and returns to the trigger when it closes.", "Escape and a tap on the scrim dismiss it; it animates out as well as in, and a person can interrupt that.", "Name it with `label`. The first focusable control takes focus unless you pass initialFocus."], keyboard: [["Escape", "Closes the dialog."], ["Tab / Shift + Tab", "Moves within the dialog only."]] },
  guidance: { do: ["Use for things that cannot be undone, or that need a passkey.", "Keep it short with one clear confirm button."], dont: ["Don't confirm what Undo can reverse.", "Don't open one from another."] },
  related: ["bottom-sheet", "popover", "toast"],
} satisfies Entry;
