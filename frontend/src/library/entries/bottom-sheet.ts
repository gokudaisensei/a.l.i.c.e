import type { Entry } from "../types";

export default {
  slug: "bottom-sheet", title: "Bottom sheet", category: "Overlays", status: "stable",
  description: "A sheet that rises from the bottom edge, where a thumb reaches. Drag it down or flick to dismiss. Used for a device's full controls.",
  exports: ["BottomSheet"], files: ["overlay.tsx", "overlay.css", "glass.css"],
  examples: [{ name: "basic", title: "Basic", description: "Drag the sheet down, or flick it, to close. Controls inside that need their own drag opt out with data-base-ui-swipe-ignore.", height: 520 }],
  anatomy: [{ slot: "scrim", description: "The dimmed backdrop." }, { slot: "bottom-sheet", description: "The sheet. It is a translucent glass surface with a grab handle." }],
  gestures: [
    { gesture: "Drag down or flick", does: "Dismisses; it follows the finger and a fast flick closes it sooner." },
    { gesture: "Escape", does: "Dismisses." },
  ],
  a11y: { notes: ["A dialog: focus is trapped, returns on close, and Escape dismisses it.", "Swipe down is a shortcut, never the only way: always include a Close button.", "Sliders and dials inside carry data-base-ui-swipe-ignore so dragging them never closes the sheet."], keyboard: [["Escape", "Closes the sheet."]] },
  guidance: { do: ["Put the most-used control in the lower half.", "Always include a Close button."], dont: ["Don't put a long form in it.", "Don't rely on the swipe alone to close."] },
  related: ["modal", "slider", "dial"],
} satisfies Entry;
