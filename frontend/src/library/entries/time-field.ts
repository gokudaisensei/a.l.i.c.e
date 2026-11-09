import type { Entry } from "../types";

export default {
  slug: "time-field", title: "Time field", category: "Inputs", status: "stable",
  description: "A time of day in 24-hour form. It uses the device's own time picker, so on a phone it is the native one people already know.",
  exports: ["TimeField"], files: ["time-field.tsx", "fields.css"],
  examples: [{ name: "basic", title: "Basic" }],
  a11y: { notes: ["It is a native `<input type=\"time\">`: the platform provides the picker, keyboard entry and screen-reader support.", "The label prop names it; show the purpose next to it as visible text too."] },
  guidance: { do: ["Say what the time is for: “Backup time”."], dont: ["Don't build a custom picker: the native one is faster and more accessible."] },
  related: ["text-input", "select"],
} satisfies Entry;
