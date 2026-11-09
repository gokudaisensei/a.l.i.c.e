// Builds what the component library's docs and registry are made from. Run: node scripts/build-library.mjs [--check]
//
//   src/library/entries/*.ts          one documentation page each (typed data, no JSX)
//   src/library/examples/<slug>/*.tsx the runnable examples shown on those pages (their source is what the page shows)
//   src/ui/*                          the components
//
// It writes:
//   src/library/generated/api.json       props, defaults and descriptions of every export of @/ui, read from the TypeScript
//   src/library/generated/entries.ts     the pages, in sidebar order
//   src/library/generated/examples.ts    a lazy loader for every example
//   public/r/<slug>.json, registry.json  a shadcn-style registry: each component's files, with what it depends on
//
// and fails when the library is out of step: an export of @/ui no page documents, an example file with no entry (or the
// reverse), an entry that names a missing file or export, a duplicate slug. With --check it writes nothing and fails
// if the generated files are not up to date (this is what CI runs).
import ts from "typescript";
import vm from "node:vm";
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CHECK = process.argv.includes("--check");
const SOFT = process.argv.includes("--soft"); // report problems but still write (for working on the library)
const problems = [];
const fail = (m) => problems.push(m);
const read = (p) => readFileSync(join(root, p), "utf8");
const list = (p) => (existsSync(join(root, p)) ? readdirSync(join(root, p)) : []);

/* ------------------------------------------------------------------ entries */
const CATEGORIES = ["Actions", "Inputs", "Display", "Feedback", "Overlays", "Navigation and layout", "Device controls", "Utilities"];
const entries = [];
for (const f of list("src/library/entries").filter((n) => n.endsWith(".ts")).sort()) {
  const js = ts.transpileModule(read(`src/library/entries/${f}`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  try { vm.runInNewContext(`(function(module, exports, require){${js}\n})`, {})(mod, mod.exports, () => ({})); } catch (e) { fail(`entries/${f}: cannot be read: ${e.message}`); continue; }
  const e = mod.exports.default;
  if (!e) { fail(`entries/${f}: no default export`); continue; }
  e.__file = f;
  entries.push(e);
}
const slugs = new Set();
for (const e of entries) {
  const at = `entries/${e.__file}`;
  for (const k of ["slug", "title", "category", "status", "description"]) if (!e[k]) fail(`${at}: missing ${k}`);
  if (e.slug && e.__file !== `${e.slug}.ts`) fail(`${at}: file name must be ${e.slug}.ts`);
  if (slugs.has(e.slug)) fail(`${at}: duplicate slug ${e.slug}`);
  slugs.add(e.slug);
  if (!CATEGORIES.includes(e.category)) fail(`${at}: unknown category "${e.category}"`);
  if (!["stable", "beta", "new"].includes(e.status)) fail(`${at}: unknown status "${e.status}"`);
  if (!e.exports?.length) fail(`${at}: lists no exports`);
  if (!e.examples?.length) fail(`${at}: has no examples`);
  if (!(e.description ?? "").trim().endsWith(".")) fail(`${at}: description should be a sentence ending in a full stop`);
  for (const f of e.files ?? []) if (!existsSync(join(root, "src/ui", f))) fail(`${at}: file src/ui/${f} does not exist`);
  for (const ex of e.examples ?? []) {
    const file = join(root, `src/library/examples/${e.slug}/${ex.name}.tsx`);
    if (!existsSync(file)) fail(`${at}: example file examples/${e.slug}/${ex.name}.tsx does not exist`);
    else if (!readFileSync(file, "utf8").trimStart().startsWith('"use client"')) fail(`examples/${e.slug}/${ex.name}.tsx: examples run in the browser, so each starts with "use client" (they pass event handlers to components)`);
  }
  const onDisk = list(`src/library/examples/${e.slug}`).filter((n) => n.endsWith(".tsx")).map((n) => n.replace(/\.tsx$/, ""));
  for (const n of onDisk) if (!(e.examples ?? []).some((x) => x.name === n)) fail(`${at}: examples/${e.slug}/${n}.tsx is not listed in the entry`);
  for (const r of e.related ?? []) if (!entries.some((x) => x.slug === r) && !list("src/library/entries").includes(`${r}.ts`)) fail(`${at}: related page "${r}" does not exist`);
}
for (const d of list("src/library/examples")) if (statSync(join(root, "src/library/examples", d)).isDirectory() && !slugs.has(d)) fail(`examples/${d}: no entry with that slug`);
entries.sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

/* ---------------------------------------------------------------------- api */
const cfgPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
const program = ts.createProgram([join(root, "src/ui/index.ts")], cfg.options);
const checker = program.getTypeChecker();
const indexFile = program.getSourceFile(join(root, "src/ui/index.ts"));
const api = {};
const NATIVE = { HTMLButtonElement: "button", HTMLInputElement: "input", HTMLTextAreaElement: "textarea", HTMLDivElement: "div", HTMLSpanElement: "span", HTMLLabelElement: "label", HTMLTableElement: "table", SVGSVGElement: "svg" };
const text = (s) => ts.displayPartsToString(s.getDocumentationComment(checker)).trim();
const fileOf = (d) => (d ? relative(root, d.getSourceFile().fileName) : "");
const fmt = (t) => checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope | ts.TypeFormatFlags.WriteArrowStyleSignature);

// Props that mean the same thing everywhere. A prop with its own doc comment keeps it; these fill in the rest.
const COMMON = {
  children: "The content.",
  className: "Extra class names, merged with the component's own.",
  disabled: "Turns the control off.",
  label: "Names the control for screen readers.",
  value: "The current value (controlled).",
  onChange: "Called with the new value.",
  onCommit: "Called with the final value when the person lets go.",
  open: "Whether it is open (controlled).",
  onOpenChange: "Called when it asks to open or close.",
  checked: "Whether it is on (controlled).",
  pressed: "Whether it is selected.",
  icon: "Name of an icon from the icon set.",
  min: "Smallest value.",
  max: "Largest value.",
  step: "Size of one step.",
  placeholder: "Text shown while nothing is chosen.",
};

function defaultsOf(decl) {
  const out = {};
  const fn = decl && (ts.isFunctionDeclaration(decl) ? decl : ts.isVariableDeclaration(decl) && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) ? decl.initializer : null);
  const p = fn?.parameters?.[0]?.name;
  if (p && ts.isObjectBindingPattern(p)) for (const el of p.elements) if (el.initializer && ts.isIdentifier(el.propertyName ?? el.name)) out[(el.propertyName ?? el.name).text] = el.initializer.getText();
  return out;
}

for (const sym of checker.getExportsOfModule(checker.getSymbolAtLocation(indexFile))) {
  const name = sym.getName();
  const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
  if (!(target.flags & ts.SymbolFlags.Value)) continue; // types are documented through the props that use them
  const decl = target.valueDeclaration ?? target.declarations?.[0];
  const type = checker.getTypeOfSymbolAtLocation(target, decl);
  const sig = type.getCallSignatures()[0];
  const jsdoc = text(target);
  if (!sig) { api[name] = { kind: "constant", file: fileOf(decl), description: jsdoc, props: [], inherits: [] }; continue; }
  const kind = /^use[A-Z]/.test(name) ? "hook" : /^[A-Z]/.test(name) ? "component" : "function";
  const param = sig.getParameters()[0];
  const props = [], inherits = new Set();
  if (kind === "component" && param) {
    const ptype = checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration);
    const defaults = defaultsOf(decl);
    for (const prop of checker.getPropertiesOfType(ptype)) {
      const d = prop.valueDeclaration ?? prop.declarations?.[0];
      const file = fileOf(d);
      if (file.includes("node_modules")) {
        if (file.includes("@base-ui/react/internals")) continue; else if (file.includes("@base-ui")) inherits.add(`@base-ui/react/${(file.match(/@base-ui\/react\/([a-z-]+)/) ?? [])[1] ?? "?"}`);
        else if (prop.getName() === "onClick" || prop.getName() === "onChange") { const m = fmt(checker.getTypeOfSymbolAtLocation(prop, d)).match(/(HTML\w+Element|SVGSVGElement)/); if (m && NATIVE[m[1]]) inherits.add(NATIVE[m[1]]); }
        continue;
      }
      props.push({ name: prop.getName(), type: fmt(checker.getTypeOfSymbolAtLocation(prop, d)).replace(/\s+/g, " ").replace(/ \| (undefined|null)/g, ""), required: !(prop.flags & ts.SymbolFlags.Optional), ...(defaults[prop.getName()] ? { default: defaults[prop.getName()] } : {}), description: text(prop) || COMMON[prop.getName()] || "" });
    }
    props.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
  }
  api[name] = { kind, file: fileOf(decl), description: jsdoc, props, inherits: [...inherits].sort() };
}
const apiSorted = Object.fromEntries(Object.entries(api).sort(([a], [b]) => a.localeCompare(b)));

/* ------------------------------------------------------------- completeness */
const documented = new Set(entries.flatMap((e) => e.exports ?? []));
for (const n of Object.keys(api)) if (!documented.has(n)) fail(`@/ui exports "${n}" but no page documents it (add it to an entry's exports)`);
for (const e of entries) for (const n of e.exports ?? []) if (!api[n]) fail(`entries/${e.__file}: "${n}" is not exported from @/ui`);
for (const [n, a] of Object.entries(api)) if (a.kind === "component" && !a.description) fail(`@/ui "${n}" (${a.file}): add a doc comment above it, the page shows it`);
for (const [n, a] of Object.entries(api)) for (const p of a.props) if (!p.description && a.kind === "component") fail(`@/ui "${n}" prop "${p.name}" (${a.file}): add a doc comment`);

/* ------------------------------------------------------------------ outputs */
const q = (s) => JSON.stringify(s);
const entriesTs = `// Generated by scripts/build-library.mjs. Do not edit.\nimport type { Entry } from "../types";\n${entries.map((e, i) => `import e${i} from "../entries/${e.slug}";`).join("\n")}\n\n/** Every documentation page, in sidebar order. */\nexport const entries: Entry[] = [${entries.map((_, i) => `e${i}`).join(", ")}];\n`;
const exampleKeys = entries.flatMap((e) => (e.examples ?? []).map((x) => `${e.slug}/${x.name}`));
const examplesTs = `// Generated by scripts/build-library.mjs. Do not edit.\nimport type { ExampleModule } from "../types";\n\n/** Loads one example by "<slug>/<name>". */\nexport const exampleLoaders: Record<string, () => Promise<ExampleModule>> = {\n${exampleKeys.map((k) => `  ${q(k)}: () => import(${q(`../examples/${k}`)}),`).join("\n")}\n};\n`;
const apiJson = JSON.stringify(apiSorted, null, 2) + "\n";

// the registry: every component page as an installable item, with its files and what it needs
const fileOwner = {};
for (const e of entries) for (const f of e.files ?? []) fileOwner[f.replace(/\.(tsx|ts|css)$/, "")] ??= e.slug;
const npmDeps = (src) => [...new Set([...src.matchAll(/from "([^"./@][^"]*|@[^"/]+\/[^"/]+)(?:\/[^"]*)?"/g)].map((m) => m[1]).filter((d) => !["react", "react-dom", "next"].includes(d)))].sort();
const registry = [];
for (const e of entries) {
  const files = [];
  for (const f of e.files ?? []) {
    files.push({ path: `ui/${f}`, type: f.endsWith(".css") ? "registry:style" : "registry:ui", content: read(`src/ui/${f}`) });
    if (/\.tsx?$/.test(f)) { const css = f.replace(/\.tsx?$/, ".css"); if (existsSync(join(root, "src/ui", css)) && !(e.files ?? []).includes(css)) files.push({ path: `ui/${css}`, type: "registry:style", content: read(`src/ui/${css}`) }); }
  }
  const srcAll = files.map((f) => f.content).join("\n");
  const rel = [...new Set([...srcAll.matchAll(/from "\.\/([a-z-]+)"/g)].map((m) => fileOwner[m[1]]).filter((s) => s && s !== e.slug))].sort();
  registry.push({
    $schema: "https://ui.shadcn.com/schema/registry-item.json", name: e.slug, type: "registry:ui", title: e.title, description: e.description,
    dependencies: npmDeps(srcAll), registryDependencies: rel, files,
    meta: { category: e.category, status: e.status, exports: e.exports },
  });
}
const registryIndex = { $schema: "https://ui.shadcn.com/schema/registry.json", name: "alice-ui", homepage: "/library", items: registry.map(({ files, $schema, ...r }) => ({ ...r, files: files.map((f) => ({ path: f.path, type: f.type })) })) };

const outputs = {
  "src/library/generated/api.json": apiJson,
  "src/library/generated/entries.ts": entriesTs,
  "src/library/generated/examples.ts": examplesTs,
  "public/r/registry.json": JSON.stringify(registryIndex, null, 2) + "\n",
  ...Object.fromEntries(registry.map((r) => [`public/r/${r.name}.json`, JSON.stringify(r, null, 2) + "\n"])),
};

if (problems.length) { console.error(problems.join("\n") + `\n\n${problems.length} problem(s) in the component library`); if (!SOFT) process.exit(1); }

if (CHECK) {
  const stale = Object.entries(outputs).filter(([p, c]) => !existsSync(join(root, p)) || read(p) !== c).map(([p]) => p);
  const extra = list("public/r").filter((n) => n.endsWith(".json") && !(`public/r/${n}` in outputs));
  if (stale.length || extra.length) { console.error(`The generated library files are out of date: ${[...stale, ...extra.map((n) => `public/r/${n} (should not exist)`)].join(", ")}\nRun: node scripts/build-library.mjs`); process.exit(1); }
  console.log(`library ok (${entries.length} pages, ${Object.keys(api).length} exports, ${exampleKeys.length} examples)`);
} else {
  mkdirSync(join(root, "public/r"), { recursive: true });
  for (const n of list("public/r")) if (n.endsWith(".json") && !(`public/r/${n}` in outputs)) rmSync(join(root, "public/r", n));
  for (const [p, c] of Object.entries(outputs)) writeFileSync(join(root, p), c);
  console.log(`library built: ${entries.length} pages, ${Object.keys(api).length} exports, ${exampleKeys.length} examples, ${registry.length} registry items`);
}
