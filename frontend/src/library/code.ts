import { createHighlighter, type Highlighter } from "shiki";

export type Lang = "tsx" | "ts" | "css" | "bash" | "json";
let highlighter: Promise<Highlighter> | undefined;

/** Syntax-highlights code on the server, in a light and a dark theme at once (switched by CSS, so there is no flash). */
export async function highlight(code: string, lang: Lang): Promise<string> {
  "use cache"; // highlighting uses clocks, which a prerender may not read; cached, it runs once per snippet
  highlighter ??= createHighlighter({ themes: ["github-light-high-contrast", "github-dark-high-contrast"], langs: ["tsx", "ts", "css", "bash", "json"] });
  return (await highlighter).codeToHtml(code.replace(/\n$/, ""), { lang, themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" }, defaultColor: false });
}
