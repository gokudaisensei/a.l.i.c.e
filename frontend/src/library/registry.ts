import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./generated/entries";
import api from "./generated/api.json";
import { CATEGORIES, type Api, type Category, type Entry, type Foundation } from "./types";

export { entries };
export const apiOf = api as Api;

/** The pages that explain the design language. Their content lives in `docs/foundations.tsx`. */
export const foundations: Foundation[] = [
  { slug: "introduction", title: "Introduction", description: "What the library is, how it is built, and how to use it." },
  { slug: "colors", title: "Colour", description: "The palette, what each colour means, and the contrast it is held to." },
  { slug: "typography", title: "Typography", description: "Three typefaces and the text styles built from them." },
  { slug: "surfaces", title: "Surfaces", description: "Radius, depth, spacing and hit targets." },
  { slug: "gestures", title: "Gestures", description: "The few gestures every control shares, and which component answers which." },
  { slug: "haptics", title: "Haptics", description: "What each tap, step and bump feels like, and when it is allowed to." },
  { slug: "motion", title: "Motion", description: "One family of curves, and when to move at all." },
  { slug: "materials", title: "Materials", description: "The glass layer for controls that float above content." },
  { slug: "icons", title: "Icons", description: "The icon set, with its solid forms." },
  { slug: "layout", title: "Layout", description: "Pieces that wrap by default." },
  { slug: "text-size", title: "Text size", description: "How the layout adapts when people make text larger." },
  { slug: "contributing", title: "Contributing", description: "The component contract, and how to add or change a component." },
];

export const byCategory = (): { category: Category; items: Entry[] }[] =>
  CATEGORIES.map((category) => ({ category, items: entries.filter((e) => e.category === category) })).filter((g) => g.items.length);

export const entryBySlug = (slug: string) => entries.find((e) => e.slug === slug);

/** A file under `src/` as text, for showing its source. Read on the server, at render. */
export function sourceOf(path: string): string {
  return readFileSync(join(process.cwd(), "src", path), "utf8");
}

/** The text of an example, without the file's import of the library's own examples helper. */
export const exampleSource = (slug: string, name: string) => sourceOf(`library/examples/${slug}/${name}.tsx`);
