import type { ComponentType } from "react";

/** Where a page sits in the sidebar. The order here is the order there. */
export const CATEGORIES = ["Actions", "Inputs", "Display", "Feedback", "Overlays", "Navigation and layout", "Device controls", "Utilities"] as const;
export type Category = (typeof CATEGORIES)[number];

/** stable: safe to build on · beta: may change · new: just added, give feedback. */
export type Status = "stable" | "beta" | "new";

export interface ExampleMeta {
  /** File name without extension, under `examples/<slug>/`. */
  name: string;
  title: string;
  description?: string;
  /** Fixed preview height in px for things that float (sheets, dialogs, toasts). Otherwise the frame fits its content. */
  height?: number;
}

/** One documentation page for a component or a family of closely related components. */
export interface Entry {
  slug: string;
  title: string;
  category: Category;
  status: Status;
  /** One or two sentences: what it is for and when to reach for it. */
  description: string;
  /** Names exported from `@/ui` that this page documents. Their props tables are generated from the TypeScript. */
  exports: string[];
  /** Source files in `src/ui` (without the folder) that make up the component: shown and shipped in the registry. */
  files: string[];
  examples: ExampleMeta[];
  /** The slots the component exposes as `data-slot`, for styling from outside. */
  anatomy?: { slot: string; description: string }[];
  /** How it responds to touch and pointer, and what each response feels like. One row per gesture. */
  gestures?: { gesture: string; does: string; haptic?: string }[];
  a11y?: { keyboard?: [string, string][]; notes: string[] };
  guidance?: { do: string[]; dont: string[] };
  /** Slugs of pages worth reading next. */
  related?: string[];
}

/** A runnable example: a default-exported component in `examples/<slug>/<name>.tsx`. */
export type ExampleModule = { default: ComponentType };

/** What the generator extracts from the TypeScript for each export of `@/ui`. */
export interface ApiProp { name: string; type: string; required: boolean; default?: string; description: string }
export interface ApiExport {
  kind: "component" | "hook" | "function" | "constant";
  file: string;
  description: string;
  props: ApiProp[];
  /** What else it accepts: "button" means every native `<button>` attribute, `@base-ui/react/switch` means that primitive's props. */
  inherits: string[];
}
export type Api = Record<string, ApiExport>;

/** A page that explains a part of the design language rather than one component. */
export interface Foundation { slug: string; title: string; description: string }
