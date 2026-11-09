import type { Entry } from "../types";

export default {
  slug: "empty", title: "Empty", category: "Display", status: "stable",
  description: "What to show when there is nothing yet. It is temporary: say what to do next.",
  exports: ["Empty"], files: ["empty.tsx", "empty.css"],
  examples: [{ name: "basic", title: "Basic" }, { name: "with-action", title: "With an action", description: "The action prop holds the next step, so an empty state is a signpost and not a dead end." }],
  anatomy: [{ slot: "empty", description: "The panel." }],
  a11y: { notes: ["It is plain text in a panel: make the next step a real button or link.", "Don't put anything critical only in an empty state: it goes away."] },
  guidance: { do: ["Say what to do: “Star a device in Rooms to pin it here.”"], dont: ["Don't leave a blank area, and don't apologise."] },
  related: ["loading", "notice"],
} satisfies Entry;
