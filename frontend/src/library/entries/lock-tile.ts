import type { Entry } from "../types";

export default {
  slug: "lock-tile", title: "Lock tile", category: "Device controls", status: "stable",
  description: "A door tile for a dark surface. It turns amber when the door is unlocked. Unlocking is a sensitive action and asks for a passkey first.",
  exports: ["LockTile"], files: ["lock-tile.tsx", "lock-tile.css"],
  examples: [{ name: "basic", title: "Locked and unlocked", description: "Unlocking should always step up to a passkey; see ConfirmDialog.", height: 200 }],
  anatomy: [{ slot: "lock-tile", description: "The button. `data-locked` is set while the door is locked." }],
  gestures: [
    { gesture: "Tap", does: "Asks for a passkey to unlock, or locks at once.", haptic: "light, success (from the dialog)" },
  ],
  a11y: { notes: ["The visible name and status (“Front door”, “Locked”) are the accessible name, so voice control works; `hint` adds what a tap does (“Tap to unlock.”) for screen readers.", "State is shown by an icon and words (“Locked”, “Open · tap to lock”), not by colour alone.", "Unlocking is never one stray tap: it goes through a passkey confirmation."] },
  guidance: { do: ["Write the status in words.", "Confirm unlocking with a passkey."], dont: ["Don't let a swipe or drag unlock."] },
  related: ["modal", "device-tile"],
} satisfies Entry;
