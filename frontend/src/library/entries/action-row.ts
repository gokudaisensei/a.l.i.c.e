import type { Entry } from "../types";

export default {
  slug: "action-row", title: "Action row", category: "Device controls", status: "stable",
  description: "One step in a list of things to do: a verb followed by the controls that finish it, with a remove button. The automation, scene and routine builders are made of these.",
  exports: ["ActionRow"], files: ["action-row.tsx", "action-row.css", "floating.tsx"],
  examples: [{ name: "basic", title: "Basic", description: "The verb says what the step does; its controls finish the sentence." }],
  anatomy: [{ slot: "action-row", description: "The row." }],
  gestures: [
    { gesture: "Tap the remove button", does: "Removes the step." },
  ],
  a11y: { notes: ["The remove button's name includes the verb (“Remove: Turn on”), so a list of rows is not a list of identical buttons.", "Keep the controls in reading order after the verb, so the row reads as a sentence."] },
  guidance: { do: ["Make the row read like a sentence: “Turn on  Floor lamp”."], dont: ["Don't put unrelated controls in one row."] },
  related: ["select", "stepper"],
} satisfies Entry;
