// Guardrails for text that scales (see DESIGN.md, "Text scales"). Run with `npm run lint:css`.
//  1. No px in a font size, except as a cap inside min(), max() or clamp().
//  2. `white-space: nowrap` must truncate on purpose (text-overflow in the same rule) or be on the NOWRAP_OK list below.
//  3. A text box gets min-height, not height: `height: Npx` only on rules that look like icons, tracks or dials (the name or comment says so), or on the DECOR list.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".css") ? [p] : []; });
const files = walk(new URL("../src", import.meta.url).pathname);
const ICONISH = /\.(ic|icon|av|dot|dico|ei|lk|sw|sw-t|rng|cthumb|wthumb|dial|cwheel|wstrip|cshade|chandle|ring|step-btn|icon-btn|dmore|fab|rec|live|sr|spin|mark|logo|badge|pill-dot|ind|th|bar|track|thumb|cam|ph|skel|swatch|sw|av)\b/;
// Short single-line labels whose layout is handled by a tier rule in ui/tiers.css, a scroller, or bounded chrome.
const NOWRAP_OK = /\.(live|nav a|pill|rchip|tab|seg button|toast-undo|btn)\b/;
// Decorative or icon-sized boxes with no text.
const DECOR = /(::before|::after|\.(dotnew|cbx|dotb|loading-mark|pk-ic|grab|toast-i|toast-x|toast-bar))/;
const problems = [];

for (const f of files) {
  const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(css))) {
    const sel = m[1].trim(), body = m[2];
    if (sel.startsWith("@") || sel.startsWith("from") || sel.startsWith("to") || /^\d+%/.test(sel)) continue;
    const line = css.slice(0, m.index + m[0].indexOf("{")).split("\n").length;
    const at = `${f.replace(/.*\/src\//, "src/")}:${line} ${sel.split(",")[0].trim().slice(0, 40)}`;
    for (const d of body.split(";")) {
      const [prop, ...rest] = d.split(":"); const p = prop.trim(); const v = rest.join(":");
      if (p === "font-size" || p === "font") {
        const bare = v.replace(/(min|max|clamp)\([^)]*\)/g, "");
        if (/\b\d*\.?\d+px\b/.test(bare)) problems.push(`${at}: px font size (use rem): ${p}:${v.trim().slice(0, 50)}`);
      }
    }
    if (/white-space\s*:\s*nowrap/.test(body) && !/text-overflow/.test(body) && !NOWRAP_OK.test(sel)) problems.push(`${at}: nowrap without text-overflow or a "nowrap:" comment`);
    if (/(^|;)\s*height\s*:\s*\d+(\.\d+)?px/.test(body) && !ICONISH.test(sel) && !DECOR.test(sel)) problems.push(`${at}: fixed height in px on what may be text (use min-height; if it is an icon or decoration add it to ICONISH or DECOR in scripts/check-css.mjs)`);
  }
}
if (problems.length) { console.error(problems.join("\n") + `\n\n${problems.length} problem(s)`); process.exit(1); }
console.log(`css ok (${files.length} files)`);
