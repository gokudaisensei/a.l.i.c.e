import type { Entry } from "../types";

export default {
  slug: "dial", title: "Dial", category: "Device controls", status: "stable",
  description: "A radial control: drag around a 270° arc to set a value, like a thermostat's target or a fan's speed. It previews while you drag and commits when you let go.",
  exports: ["Dial"], files: ["dial.tsx", "dial.css", "use-drag.ts"],
  examples: [
    { name: "thermostat", title: "Thermostat", description: "A marker on the same arc shows the room's current temperature: the gap is the work left to do. Double-tap returns to 22°." },
    { name: "fan", title: "Fan speed", description: "All the way down means off." },
  ],
  anatomy: [{ slot: "dial", description: "The control. It is a slider for assistive technology." }],
  gestures: [
    { gesture: "Drag around the arc", does: "Sets the value: a tick per step, a click at each quarter, a bump at either end.", haptic: "tick, detent, boundary" },
    { gesture: "Double-tap (with `resetValue`)", does: "Returns to the default.", haptic: "medium" },
    { gesture: "Arrow keys", does: "Step." },
  ],
  a11y: {
    notes: ["role=\"slider\" with min, max, current value and a value text such as “24°”; arrow keys step it.", "A circular control is unusual for a plain number: always offer plus and minus beside it (the device sheets do), because dragging an arc is hard for some people.", "Dragging across the gap at the bottom is ignored rather than jumping the value from one end to the other."],
    keyboard: [["Arrow keys", "Step the value up or down."]],
  },
  guidance: { do: ["Show the value large in the centre.", "Offer plus and minus buttons beside it."], dont: ["Don't use for values far from a physical dial (use Slider)."] },
  related: ["slider", "stepper", "device-tile"],
} satisfies Entry;
