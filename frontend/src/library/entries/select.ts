import type { Entry } from "../types";

export default {
  slug: "select", title: "Select", category: "Inputs", status: "stable",
  description: "A drop-down list for one choice among many. A real popup rather than the browser's native one, so it matches the interface and works the same everywhere.",
  exports: ["Select"], files: ["select.tsx", "fields.css", "floating.css"],
  examples: [
    { name: "basic", title: "Basic", height: 260 },
    { name: "with-label", title: "With a visible label", description: "Wrap it in a Field so the label is clickable and names the control.", height: 260 },
  ],
  anatomy: [{ slot: "select", description: "The trigger button. `data-popup-open` is set while the list is open." }],
  gestures: [
    { gesture: "Tap", does: "Opens the list; tap an option to choose it.", haptic: "select" },
    { gesture: "Type a letter", does: "Jumps to the next matching option." },
    { gesture: "Arrow keys, Enter, Escape", does: "Move, choose, close.", haptic: "select" },
  ],
  a11y: {
    notes: ["Opens as a listbox with type-ahead: typing jumps to the matching option.", "Needs a name: wrap it in a Field or pass `label`.", "On touch the list opens below the field and does not take over the screen."],
    keyboard: [["Enter / Space / Arrow Down", "Opens the list."], ["Arrow keys", "Move through the options."], ["Enter", "Chooses the highlighted option."], ["Escape", "Closes without changing."], ["Type a letter", "Jumps to the next option starting with it."]],
  },
  guidance: { do: ["Use for six or more options.", "Order options so people can scan them (alphabetical, or by likelihood)."], dont: ["Don't use for two to five options (use Segmented).", "Don't hide a destructive action inside it."] },
  related: ["segmented", "text-input"],
} satisfies Entry;
