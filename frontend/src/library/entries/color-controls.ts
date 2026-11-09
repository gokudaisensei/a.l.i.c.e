import type { Entry } from "../types";

export default {
  slug: "color-controls", title: "Colour controls", category: "Device controls", status: "stable",
  description: "A colour wheel (angle is hue, distance from the centre is saturation) and a warm-to-cool strip for white light, for lamps that can do colour.",
  exports: ["ColorWheel", "WhiteStrip"], files: ["color-control.tsx", "color-control.css", "use-drag.ts"],
  examples: [
    { name: "wheel", title: "Colour wheel", description: "Previews while you drag; the colour is sent when you let go." },
    { name: "white", title: "White strip", description: "The track shows the real colour at each end of the lamp's own range." },
  ],
  anatomy: [{ slot: "color-wheel", description: "The wheel." }, { slot: "white-strip", description: "The warm-to-cool strip." }],
  gestures: [
    { gesture: "Drag on the wheel", does: "Hue is the angle, saturation the distance. Ticks every 30 degrees, a click through the centre (white), a bump at the rim.", haptic: "tick, detent, boundary" },
    { gesture: "Double-tap the wheel", does: "Straight to white.", haptic: "medium" },
    { gesture: "Drag on the strip", does: "Ticks every 500 K, a bump at either end, a flick carries on.", haptic: "tick, boundary" },
  ],
  a11y: { notes: ["Both are role=\"slider\" with a value text (“Hue 25 degrees, 90% saturation”, “3000 Kelvin”); arrow keys change the hue or the temperature.", "Colour is the thing being chosen, so these cannot avoid colour: always show the colour's effect as text or a swatch beside them, and offer named presets (Candle, Reading, Focus, Movie).", "A light device shows only what the lamp can do: no wheel for a lamp without colour."], keyboard: [["Arrow Left / Right", "Change the hue (wheel) or the temperature (strip)."]] },
  guidance: { do: ["Offer named moods beside them.", "Take the Kelvin range from the lamp."], dont: ["Don't show them for a lamp that cannot do colour."] },
  related: ["slider", "dial", "device-tile"],
} satisfies Entry;
