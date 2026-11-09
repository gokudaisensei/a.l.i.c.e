import type { Entry } from "../types";

export default {
  slug: "text-input", title: "Text input", category: "Inputs", status: "stable",
  description: "Single and multi-line text fields, and the Field that gives one a label. Native inputs with the app's look: every attribute works.",
  exports: ["Input", "Textarea", "Field", "FieldRow"], files: ["fields.tsx", "fields.css"],
  examples: [
    { name: "field", title: "Field and input", description: "The Field is a label around the control, so tapping the label focuses it." },
    { name: "sizes", title: "Sizes", description: "Width classes instead of inline widths: inp--sm, inp--code, inp--fill." },
    { name: "textarea", title: "Textarea" },
  ],
  anatomy: [{ slot: "field", description: "The label element that wraps the text and the control." }, { slot: "field-row", description: "Several fields on one row." }, { slot: "input", description: "The `<input>`." }, { slot: "textarea", description: "The `<textarea>`." }],
  a11y: {
    notes: ["Every input needs a name: a Field around it, or aria-label.", "Use the right `type`, `inputMode` and `autoComplete` so phones show the right keyboard and offer to fill it.", "Show errors next to the field with a Notice or text, say how to fix it, and don't rely on colour."],
  },
  guidance: { do: ["Put a short example in the placeholder only when it helps; the label always stays.", "Validate as people type and say how to fix a problem."], dont: ["Don't use the placeholder as the label.", "Don't block paste."] },
  related: ["select", "stepper"],
} satisfies Entry;
