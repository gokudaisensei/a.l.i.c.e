import type { Entry } from "../types";

export default {
  slug: "button",
  title: "Button",
  category: "Actions",
  status: "stable",
  description: "Pill-shaped buttons for actions, with a square icon button and a round stepper button for the cases where there is no room for text.",
  exports: ["Button", "IconButton", "StepButton", "buttonVariants"],
  files: ["button.tsx", "button.css"],
  examples: [
    { name: "variants", title: "Variants", description: "One primary action per surface. Everything else is quieter." },
    { name: "sizes", title: "Sizes", description: "Large is thumb-sized and is for the main action on a phone." },
    { name: "loading", title: "Loading", description: "The button keeps its width, shows a spinner and ignores taps until the work is done." },
    { name: "icon-buttons", title: "Icon and stepper buttons", description: "No text means a name is required: the accessible name is a required prop." },
    { name: "as-link", title: "A link that looks like a button", description: "buttonVariants gives the class names, so a link or any other element can wear the button's look." },
  ],
  anatomy: [
    { slot: "button", description: "The button. `data-variant` holds the variant, `data-loading` is set while loading." },
    { slot: "icon-button", description: "The square icon-only button. `data-active` is set when it is the current choice." },
    { slot: "step-button", description: "The round plus-or-minus button used in steppers." },
  ],
  gestures: [
    { gesture: "Press", does: "The button presses in and springs back. With a pointer it gets a faint veil." },
    { gesture: "Loading", does: "Presses are ignored until the work is done." },
    { gesture: "`haptic` prop", does: "Opt in to a haptic on press: `medium` for the one action that sends something out, `warning` for a danger button.", haptic: "medium" },
  ],
  a11y: {
    notes: [
      "It is a real <button>, so Enter and Space activate it and it takes part in the tab order.",
      "While loading it sets aria-busy and is disabled, so a second press cannot happen and assistive tech knows it is working.",
      "IconButton and StepButton require an aria-label in their types: with no text there is nothing else to read.",
      "Touch targets are at least 44 px tall (the icon button's visible square is smaller, its hit area is padded).",
    ],
    keyboard: [["Enter", "Activates the button."], ["Space", "Activates the button."], ["Tab", "Moves to the next control."]],
  },
  guidance: {
    do: ["Use one primary button per surface, for the main thing to do.", "Start the label with a verb: Save, Turn on, Add favourite.", "Show a loading state instead of swapping the label for a long word."],
    dont: ["Don't put two primary buttons side by side.", "Don't use danger for something that can be undone: offer Undo instead.", "Don't use an icon button without a name."],
  },
  related: ["tabs", "stepper"],
} satisfies Entry;
