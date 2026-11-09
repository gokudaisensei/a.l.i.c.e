import type { Entry } from "../types";

export default {
  slug: "stepper", title: "Stepper", category: "Inputs", status: "stable",
  description: "A number you nudge up and down with round buttons, held between a minimum and a maximum. For small counts, not free typing.",
  exports: ["Stepper"], files: ["stepper.tsx", "stepper.css", "button.tsx"],
  examples: [
    { name: "basic", title: "Basic" },
    { name: "range", title: "A longer range", description: "Press and hold to run through a range; it speeds up the longer you hold." },
  ],
  anatomy: [{ slot: "stepper", description: "The group holding both buttons and the value." }],
  gestures: [
    { gesture: "Tap a button", does: "One step.", haptic: "light (boundary at an end)" },
    { gesture: "Press and hold", does: "Steady, then faster the longer you hold.", haptic: "tick" },
    { gesture: "Drag the number sideways", does: "Scrubs: one step every few pixels.", haptic: "tick, boundary at an end" },
    { gesture: "Arrow keys", does: "One step.", haptic: "light" },
  ],
  a11y: {
    notes: ["A labelled group: the label names it, and each button says what it does (“Fewer: Backups to keep”).", "The value is a live region, so a screen reader announces changes.", "Buttons disable at the ends of the range."],
    keyboard: [["Arrow Up / Arrow Right", "Increases the value."], ["Arrow Down / Arrow Left", "Decreases the value."], ["Enter / Space on a button", "Steps once."]],
  },
  guidance: { do: ["Use the unit prop so the number reads naturally.", "Use for ranges of a few dozen values or fewer."], dont: ["Don't use for a wide range (use a number Input).", "Don't use for continuous values (use Slider)."] },
  related: ["slider", "text-input", "button"],
} satisfies Entry;
