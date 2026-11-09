import type { Entry } from "../types";

export default {
  slug: "notice", title: "Notice", category: "Feedback", status: "stable",
  description: "An inline message that stays on the page: something to know, something that worked, or something to fix.",
  exports: ["Notice"], files: ["notice.tsx", "notice.css"],
  examples: [
    { name: "tones", title: "Tones" },
    { name: "with-action", title: "With an action", description: "Put the fix next to the problem." },
  ],
  anatomy: [{ slot: "notice", description: "The message. `data-tone` holds the tone." }],
  a11y: { notes: ["warn uses role=\"alert\", so it is announced as soon as it appears; the others use role=\"status\".", "The icon and the words both carry the meaning, so colour is never alone.", "Write what is true and what to do: “The address needs http:// at the start.”"] },
  guidance: { do: ["Say how to fix it.", "Keep it next to what it is about."], dont: ["Don't blame: no “you entered it wrong”.", "Don't use for a passing event (use Toast)."] },
  related: ["toast", "badge"],
} satisfies Entry;
