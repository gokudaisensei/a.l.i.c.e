import type { Entry } from "../types";

export default {
  slug: "slider", title: "Slider", category: "Inputs", status: "stable",
  description: "A filled bar for a value along a range, like brightness. The fill glides when the value jumps, and the thumb lifts while it is held.",
  exports: ["Slider"], files: ["slider.tsx", "slider.css"],
  examples: [
    { name: "basic", title: "Basic" },
    { name: "large", title: "Large", description: "The tall bar for sheets: easy to hit with a thumb.", height: 140 },
    { name: "with-value", title: "With its value", description: "showValue gives live feedback as you drag, and valueText gives screen readers real words (“60%”, not “60”)." },
    { name: "with-reset", title: "Double-tap to reset", description: "resetValue gives the bar a default to come back to." },
    { name: "with-presets", title: "With presets", description: "Presets move the same value; a slider is never the only way to set it." },
  ],
  anatomy: [{ slot: "slider", description: "The root. `data-size` is `md` or `xl`; `data-dragging` is set while held." }],
  gestures: [
    { gesture: "Drag", does: "Sets the value; the thumb lifts. A tick every twentieth, a click at each quarter, a bump at either end.", haptic: "tick, detent, boundary" },
    { gesture: "Tap on the track", does: "Jumps there." },
    { gesture: "Double-tap (with `resetValue`)", does: "Returns to the default.", haptic: "medium" },
    { gesture: "Arrow keys, Home, End", does: "Step, or jump to an end." },
  ],
  a11y: {
    notes: ["Exposed as role=\"slider\" with its value and range; the label prop names the thumb.", "Inside a bottom sheet it opts out of swipe-to-dismiss, so dragging never closes the sheet.", "Offer another way to set an exact value (preset buttons, or plus and minus): a drag is hard for some people."],
    keyboard: [["Arrow Left / Arrow Down", "Decreases the value by one step."], ["Arrow Right / Arrow Up", "Increases the value by one step."], ["Home / End", "Jumps to the minimum or maximum."]],
  },
  guidance: { do: ["Show the value as a number nearby.", "Pair it with presets or steppers."], dont: ["Don't use it for a value that needs exactness (use Stepper).", "Don't use it for audio volume where the system provides a control."] },
  related: ["nudge", "stepper", "dial", "color-controls"],
} satisfies Entry;
