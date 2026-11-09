import type { Entry } from "../types";

export default {
  slug: "cover-shade", title: "Cover shade", category: "Device controls", status: "stable",
  description: "A window with a shade you pull, for blinds, curtains and roofs: drag down to close, up to open. Open, Stop and Close buttons sit beneath it.",
  exports: ["CoverShade"], files: ["color-control.tsx", "color-control.css", "use-drag.ts"],
  examples: [{ name: "basic", title: "Basic", description: "The handle pulses while the cover is moving." }],
  anatomy: [{ slot: "cover-shade", description: "The window and shade. `data-moving` is set while the cover is moving." }],
  gestures: [
    { gesture: "Drag", does: "Pull the shade down to close, up to open; a click at each quarter.", haptic: "detent, tick" },
    { gesture: "Pull past an end", does: "The shade stretches with growing resistance and bumps, then settles back.", haptic: "boundary" },
    { gesture: "Flick", does: "Carries on and lands where its speed would take it." },
    { gesture: "Arrow keys", does: "Ten at a time." },
  ],
  a11y: { notes: ["role=\"slider\" with the position as its value; arrow keys move it ten steps at a time.", "The device sheet also has Open, Stop and Close buttons and plus and minus, so a drag is never required.", "For garages and gates, opening is a sensitive action and goes through a passkey."], keyboard: [["Arrow Up / Down", "Open or close in steps of ten."]] },
  guidance: { do: ["Show “Opening…” and “Closing…” in words."], dont: ["Don't let a garage or gate be moved by a stray drag without a confirmation."] },
  related: ["dial", "device-tile"],
} satisfies Entry;
