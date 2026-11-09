import type { Entry } from "../types";

export default {
  slug: "utilities", title: "Utilities", category: "Utilities", status: "stable",
  description: "The small helpers the components share: cn joins class names, useDrag turns a pointer drag into 0 to 1 positions and a release velocity, project lets a flick carry on, useDoubleTap and useSwipeSelect are the other two gestures, and Html renders trusted markup.",
  exports: ["cn", "useDrag", "project", "useDoubleTap", "useSwipeSelect", "Html"], files: ["cn.ts", "use-drag.ts", "use-double-tap.ts", "use-swipe-select.ts", "html.tsx"],
  examples: [
    { name: "cn", title: "cn", description: "Joins class names, skipping falsy values; arrays and `{ name: condition }` objects are flattened." },
    { name: "use-drag", title: "useDrag and project", description: "The base of every drag control: pointer capture, positions as fractions of the element, and on release the position and the speed. project lands a flick where its speed would take it, the way a scroll view glides: flick the bar." },
    { name: "double-tap", title: "useDoubleTap", description: "Two quick taps in the same place. A press that moved is a drag, not a tap, so it never counts." },
    { name: "swipe-select", title: "useSwipeSelect", description: "Slide a finger across a row of choices and the one under it is chosen as it passes; a tap still clicks." },
    { name: "html", title: "Html" },
  ],
  a11y: { notes: ["useDrag is only the pointer half of a control: always add a keyboard path (arrow keys) and a role beside it, as the dial and the wheel do.", "Html does not sanitise: only pass markup that the app itself wrote."] },
  guidance: { do: ["Give every drag control an arrow-key path."], dont: ["Don't pass user input to Html."] },
  related: ["dial", "icon"],
} satisfies Entry;
