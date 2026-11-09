import type { Entry } from "../types";

export default {
  slug: "device-tile", title: "Device tile", category: "Device controls", status: "stable",
  description: "The phone tile for one device. Tap to toggle, drag sideways to set its main value, hold or press the chevron for the full controls.",
  exports: ["DeviceTile", "AddTile"], files: ["device-tile.tsx", "device-tile.css", "use-drag.ts"],
  examples: [
    { name: "lamp", title: "A dimmable lamp", description: "Drag sideways: the fill follows your finger and one command is sent when you let go. 0 means off. The tile glows in the lamp's own colour." },
    { name: "fan", title: "A fan", description: "The icon spins in step with the speed (a visual guide, not a measurement)." },
    { name: "plain-and-add", title: "Plain, warning and add tiles" },
  ],
  anatomy: [{ slot: "device-tile", description: "The wrapper holding the tile and the chevron." }, { slot: "add-tile", description: "The dashed tile that ends a grid." }],
  gestures: [
    { gesture: "Tap", does: "Toggles the device.", haptic: "toggleOn or toggleOff (from the app)" },
    { gesture: "Drag sideways", does: "Sets the main value; ticks at each quarter, stretches and bumps past an end; a flick carries on. 0 means off.", haptic: "detent, boundary" },
    { gesture: "Hold", does: "A slight press-in shows the hold is coming; then the full controls open.", haptic: "hold" },
    { gesture: "Chevron", does: "The visible twin of hold." },
  ],
  a11y: {
    notes: ["The tile is one button: its visible name and state are its accessible name (so a voice-control user can say what they see), and `hint` adds what the gestures do (“Tap to toggle. Hold for more.”) as a description.", "Every gesture has a visible twin: the chevron opens the controls, and the sheet has plus and minus buttons, so no function depends on a drag or a hold.", "Dragging only responds to a mostly-sideways move, so vertical scrolling is never captured.", "Haptic ticks at each quarter are a bonus: the value is always shown as text."],
    keyboard: [["Enter / Space", "Taps the tile."], ["Tab", "Moves to the tile, then to its chevron."]],
  },
  guidance: { do: ["Show the state in words under the name.", "Use `tint` for the device's own colour, never for text."], dont: ["Don't make the gesture the only way to a function.", "Don't hide a destructive action behind a drag."] },
  related: ["lock-tile", "dial", "cover-shade"],
} satisfies Entry;
