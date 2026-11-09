import type { Entry } from "../types";

export default {
  slug: "haptics", title: "Haptics", category: "Utilities", status: "new",
  description: "Named haptic patterns with meanings: components say what happened and haptic() decides what it feels like, how often it may happen, and whether the person wants it.",
  exports: ["haptic", "HAPTICS", "hapticsSupported", "setHapticsEnabled", "useHapticsEnabled"], files: ["haptics.ts"],
  examples: [
    { name: "try-them", title: "Try them", description: "Each one by name. On an Android phone you will feel them; on a desktop browser nothing happens, and nothing breaks." },
    { name: "setting", title: "The setting", description: "One switch for the device, remembered. The account menu in the app has this switch." },
  ],
  a11y: { notes: ["Never the only signal: every haptic is paired with something visible, because many devices cannot vibrate and many people turn it off.", "The person decides: useHapticsEnabled is the switch, remembered per device.", "Fast drags cannot turn into a buzz: tick and detent are rate limited to one every 28 ms."] },
  guidance: { do: ["Say what happened: haptic(\"toggleOn\").", "Reach for tick and detent while scrubbing, boundary at an end, success or warning for results."], dont: ["Don't ask for a duration.", "Don't use heavy for ordinary taps.", "Don't rely on a haptic to tell someone something."] },
  related: ["utilities", "nudge"],
} satisfies Entry;
