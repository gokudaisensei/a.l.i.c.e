import type { Entry } from "../types";

export default {
  slug: "mode-and-scene", title: "Mode and scene", category: "Device controls", status: "stable",
  description: "ModeButton picks the household mode (Home, Away, Night). SceneCard runs a scene or routine, and can be outlined when Alice suggests it.",
  exports: ["ModeButton", "SceneCard"], files: ["choice.tsx", "choice.css"],
  examples: [
    { name: "modes", title: "Household modes", description: "One is on at a time: aria-pressed marks it." },
    { name: "scenes", title: "Scenes" },
  ],
  anatomy: [{ slot: "mode-button", description: "A mode option; `aria-pressed` is its state." }, { slot: "scene-card", description: "A scene card; `data-suggested` is set when outlined." }],
  gestures: [
    { gesture: "Tap", does: "Chooses the mode, or runs the scene.", haptic: "medium (from the app)" },
  ],
  a11y: { notes: ["ModeButton exposes aria-pressed; the active mode is also stated in words elsewhere on the page.", "SceneCard is a button: its name and description are its text. A suggested card says so with a tag, not only an outline."] },
  guidance: { do: ["Name modes and scenes by what they do for the home."], dont: ["Don't use a scene for a single device (use its tile)."] },
  related: ["device-tile", "segmented"],
} satisfies Entry;
