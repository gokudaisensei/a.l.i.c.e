import type { Entry } from "../types";

export default {
  slug: "toast", title: "Toast", category: "Feedback", status: "stable",
  description: "A short notice at the bottom of the screen: what just happened, with Undo when it can be undone. Long messages wrap, and it never vanishes mid-sentence.",
  exports: ["Toast", "toastDuration"], files: ["toast.tsx", "toast.css"],
  examples: [
    { name: "with-undo", title: "With Undo", description: "Reversible actions offer Undo instead of asking “are you sure?”.", height: 170 },
    { name: "tones", title: "Tones", description: "Neutral, ok and warn. Warn is announced to screen readers at once, and it stays until it is dismissed.", height: 330 },
    { name: "long", title: "A long message", description: "Past five lines it folds, with a button to read the rest.", height: 260 },
  ],
  anatomy: [{ slot: "toast", description: "The card. `data-tone`, `data-show` and `data-paused` describe its state." }],
  gestures: [
    { gesture: "Appears", does: "A warning is felt as a warning, a success as a success; a plain note is silent.", haptic: "warning, success" },
    { gesture: "Swipe sideways or down", does: "Dismisses it; let go early and it springs back; a flick carries on.", haptic: "light" },
    { gesture: "Touch or hover", does: "Pauses its clock." },
    { gesture: "Undo", does: "Reverses the action.", haptic: "select" },
  ],
  a11y: {
    notes: ["It is a live region: polite for neutral and ok, assertive (role=\"alert\") for warn.", "It pauses while pointed at, focused or touched, so it cannot disappear while being read, and shows how long is left.", "A message that matters is never taken away on a timer: warn toasts stay until dismissed (duration={null} does the same for any tone), as Apple advises. The rest stay 3.2 to 10 seconds depending on length, 2.5 seconds longer with Undo, and pause while pointed at or touched."],
    keyboard: [["Tab", "Moves to Undo and Dismiss while it is shown."]],
  },
  guidance: { do: ["Say what happened and, for a failure, why.", "Offer Undo for anything reversible."], dont: ["Don't use it for an error the person must fix before going on (use Notice).", "Don't stack several at once."] },
  related: ["notice", "modal"],
} satisfies Entry;
