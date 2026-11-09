import type { Entry } from "../types";

export default {
  slug: "checkbox", title: "Checkbox", category: "Inputs", status: "stable",
  description: "A tick box for choosing any number of options. With a label it becomes a full-width tappable row.",
  exports: ["Checkbox"], files: ["checkbox.tsx", "checkbox.css"],
  examples: [
    { name: "row", title: "As a row", description: "Pass children and the whole label toggles it, which makes a 44 px target." },
    { name: "indeterminate", title: "Indeterminate", description: "Some, but not all, of what it covers is selected." },
    { name: "bare", title: "Without a label", description: "Name it with the label prop so screen readers can." },
  ],
  anatomy: [{ slot: "checkbox", description: "The box. `data-checked`, `data-indeterminate` and `data-disabled` come from Base UI." }],
  gestures: [
    { gesture: "Tap the box or its label", does: "Toggles.", haptic: "toggleOn or toggleOff" },
    { gesture: "Space", does: "Toggles.", haptic: "toggleOn or toggleOff" },
  ],
  a11y: {
    notes: ["It is a real checkbox: role, checked and mixed states are exposed.", "With children, the label wraps the box, so tapping the text toggles it.", "Without children there is no visible text: pass `label`."],
    keyboard: [["Space", "Toggles the checkbox."], ["Tab", "Moves focus to or away from it."]],
  },
  guidance: { do: ["Use for options that can be combined.", "Use indeterminate for a parent of a partly-selected group."], dont: ["Don't use for a single instant setting (use Switch).", "Don't use for exclusive choices (use Segmented)."] },
  related: ["switch", "segmented"],
} satisfies Entry;
