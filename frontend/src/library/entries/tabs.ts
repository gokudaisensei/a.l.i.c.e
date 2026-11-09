import type { Entry } from "../types";

export default {
  slug: "tabs", title: "Tabs", category: "Navigation and layout", status: "stable",
  description: "A row of pill tabs for switching between a few views of the same thing. A dark thumb slides to the chosen tab, and the row scrolls sideways when it does not fit.",
  exports: ["Tabs"], files: ["tabs.tsx", "tabs.css", "use-indicator.ts"],
  examples: [{ name: "basic", title: "Basic" }, { name: "with-badge", title: "With a badge", description: "A dot says something in that tab needs a look." }],
  anatomy: [{ slot: "tabs", description: "The tab list." }],
  gestures: [
    { gesture: "Tap", does: "Chooses the tab.", haptic: "select" },
    { gesture: "Swipe across", does: "Slide over the tabs to choose as you pass.", haptic: "select on each change" },
    { gesture: "Scroll sideways", does: "When there are more tabs than fit." },
  ],
  a11y: { notes: ["A tablist with role=\"tab\" and aria-selected; the label names the list.", "The row scrolls instead of wrapping, so every tab stays reachable.", "A badge dot has a title; also say what needs attention in the tab's content."] },
  guidance: { do: ["Use for views of one subject: Automation, Scene, Routine."], dont: ["Don't use to move between pages of the app (the tab bar does that).", "Don't nest tabs."] },
  related: ["segmented"],
} satisfies Entry;
