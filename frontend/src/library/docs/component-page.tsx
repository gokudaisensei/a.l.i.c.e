import Link from "next/link";
import { Fragment } from "react";
import { Icon } from "@/ui";
import { entries, exampleSource, sourceOf } from "../registry";
import type { Entry } from "../types";
import { CodeBlock } from "./code-block";
import { PropsTable } from "./props-table";
import { Preview } from "./preview";

const SECTIONS = [["examples", "Examples"], ["usage", "Usage"], ["api", "API"], ["anatomy", "Anatomy"], ["gestures", "Gestures"], ["a11y", "Accessibility"], ["guidance", "Guidance"], ["source", "Source"], ["install", "Install"], ["related", "Related"]] as const;

/** One component page: examples, then the usage, API, anatomy, accessibility, source and install sections. */
export async function ComponentPage({ entry }: { entry: Entry }) {
  const has: Record<string, boolean> = { examples: true, usage: true, api: true, anatomy: !!entry.anatomy?.length, gestures: !!entry.gestures?.length, a11y: !!entry.a11y, guidance: !!entry.guidance, source: !!entry.files.length, install: true, related: !!entry.related?.length };
  const importLine = `import { ${entry.exports.join(", ")} } from "@/ui";`;
  return (
    <article className="lib-article" data-slug={entry.slug}>
      <header className="lib-head">
        <div className="lib-eyebrow">{entry.category}</div>
        <h1>{entry.title} <span className={`lib-badge ${entry.status}`}>{entry.status}</span></h1>
        <p className="lib-lede">{entry.description}</p>
        <nav className="lib-toc" aria-label="On this page">{SECTIONS.filter(([k]) => has[k]).map(([k, l]) => <a key={k} href={`#${k}`}>{l}</a>)}</nav>
      </header>

      <section id="examples" aria-labelledby="h-examples">
        <h2 id="h-examples">Examples</h2>
        {await Promise.all(entry.examples.map(async (ex, i) => (
          <div key={ex.name} className="lib-example" id={`ex-${ex.name}`}>
            <h3>{ex.title}</h3>
            {ex.description ? <p>{ex.description}</p> : null}
            <Preview slug={entry.slug} name={ex.name} title={ex.title} height={ex.height} />
            <details className="lib-details" open={i === 0}>
              <summary>Code</summary>
              <CodeBlock code={exampleSource(entry.slug, ex.name)} title={`${entry.slug}/${ex.name}.tsx`} />
            </details>
          </div>
        )))}
      </section>

      <section id="usage" aria-labelledby="h-usage">
        <h2 id="h-usage">Usage</h2>
        <CodeBlock code={importLine} lang="ts" />
        <p className="lib-note">Everything is imported from <code>@/ui</code>. The components own their markup and take their look from the design tokens, so they follow the theme, the text size and the accessibility settings without extra work.</p>
      </section>

      <section id="api" aria-labelledby="h-api">
        <h2 id="h-api">API</h2>
        <p className="lib-note">Generated from the TypeScript, so it cannot drift from the code. * marks a required prop.</p>
        {entry.exports.map((n) => <PropsTable key={n} name={n} />)}
      </section>

      {entry.anatomy?.length ? (
        <section id="anatomy" aria-labelledby="h-anatomy">
          <h2 id="h-anatomy">Anatomy</h2>
          <p className="lib-note">Every part carries a <code>data-slot</code>, so it can be styled or found from outside without a class name.</p>
          <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Slot</th><th>What it is</th></tr></thead>
            <tbody>{entry.anatomy.map((a) => <tr key={a.slot}><td><code>data-slot=&quot;{a.slot}&quot;</code></td><td>{a.description}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      {entry.gestures?.length ? (
        <section id="gestures" aria-labelledby="h-gestures">
          <h2 id="h-gestures">Gestures and haptics</h2>
          <p className="lib-note">How it answers a finger or a pointer, and what each answer feels like. A gesture is never the only way: every function here also has a visible control or a key. See <Link href="/library/foundations/gestures">Gestures</Link> and <Link href="/library/foundations/haptics">Haptics</Link>.</p>
          <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Gesture</th><th>What it does</th><th>Haptic</th></tr></thead>
            <tbody>{entry.gestures.map((g) => <tr key={g.gesture}><td>{g.gesture}</td><td>{g.does}</td><td>{g.haptic ? <code>{g.haptic}</code> : <span className="lib-dash">–</span>}</td></tr>)}</tbody></table></div>
        </section>
      ) : null}

      {entry.a11y ? (
        <section id="a11y" aria-labelledby="h-a11y">
          <h2 id="h-a11y">Accessibility</h2>
          <ul className="lib-list">{entry.a11y.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          {entry.a11y.keyboard?.length ? (
            <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Key</th><th>What it does</th></tr></thead>
              <tbody>{entry.a11y.keyboard.map(([k, d]) => <tr key={k}><td>{k.split(" + ").map((x, i) => <Fragment key={x}>{i ? " + " : ""}<kbd>{x}</kbd></Fragment>)}</td><td>{d}</td></tr>)}</tbody></table></div>
          ) : null}
        </section>
      ) : null}

      {entry.guidance ? (
        <section id="guidance" aria-labelledby="h-guidance">
          <h2 id="h-guidance">Guidance</h2>
          <div className="lib-dd">
            <div className="lib-do"><h3><Icon n="check" c="sm" />Do</h3><ul>{entry.guidance.do.map((d) => <li key={d}>{d}</li>)}</ul></div>
            <div className="lib-dont"><h3><Icon n="x" c="sm" />Don&apos;t</h3><ul>{entry.guidance.dont.map((d) => <li key={d}>{d}</li>)}</ul></div>
          </div>
        </section>
      ) : null}

      {entry.files.length ? (
        <section id="source" aria-labelledby="h-source">
          <h2 id="h-source">Source</h2>
          <p className="lib-note">The components live in your repository and are yours to change. This is the code as it is now.</p>
          {await Promise.all([...entry.files, ...entry.files.filter((f) => /\.tsx?$/.test(f)).map((f) => f.replace(/\.tsx?$/, ".css"))].filter((f, i, a) => a.indexOf(f) === i).map(async (f) => {
            let code = ""; try { code = sourceOf(`ui/${f}`); } catch { return null; }
            return <details key={f} className="lib-details"><summary><code>src/ui/{f}</code></summary><CodeBlock code={code} lang={f.endsWith(".css") ? "css" : f.endsWith(".ts") ? "ts" : "tsx"} title={`src/ui/${f}`} /></details>;
          }))}
        </section>
      ) : null}

      <section id="install" aria-labelledby="h-install">
        <h2 id="h-install">Install</h2>
        <p className="lib-note">The library is published as a registry in the shadcn format: each page above is one item with its files and what it depends on. Copy the source, or fetch the item.</p>
        <CodeBlock lang="bash" code={`curl -s <your-origin>/r/${entry.slug}.json`} />
        <p className="lib-note"><a href={`/r/${entry.slug}.json`}><code>/r/{entry.slug}.json</code></a> · Depends on: {depsText(entry)}.</p>
      </section>

      {entry.related?.length ? (
        <section id="related" aria-labelledby="h-related">
          <h2 id="h-related">Related</h2>
          <ul className="lib-list lib-related">{entry.related.map((r) => { const e = entries.find((x) => x.slug === r); return e ? <li key={r}><Link href={`/library/components/${r}`}>{e.title}</Link> <span>{e.description}</span></li> : null; })}</ul>
        </section>
      ) : null}
    </article>
  );
}

function depsText(entry: Entry) {
  const own = entry.files.map((f) => sourceOf(`ui/${f}`)).join("\n");
  const npm = [...new Set([...own.matchAll(/from "([^"./@][^"]*|@[^"/]+\/[^"/]+)(?:\/[^"]*)?"/g)].map((m) => m[1]).filter((d) => !["react", "react-dom", "next"].includes(d)))];
  return npm.length ? npm.join(", ") : "nothing outside React";
}
