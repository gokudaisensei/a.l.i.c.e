import Link from "next/link";
import { byCategory, entries, foundations } from "@/library/registry";

export default function Overview() {
  return (
    <article className="lib-article">
      <header className="lib-head">
        <div className="lib-eyebrow">Alice</div>
        <h1>Component library</h1>
        <p className="lib-lede">The components, tokens and rules the interface is built from. Each page has live examples you can resize and read the code of, the API read from the TypeScript, accessibility notes, and the source itself.</p>
      </header>
      <section aria-labelledby="h-f"><h2 id="h-f">Foundations</h2>
        <div className="lib-cards">{foundations.map((f) => <Link key={f.slug} href={`/library/foundations/${f.slug}`} className="lib-card"><b>{f.title}</b><span>{f.description}</span></Link>)}</div></section>
      {byCategory().map((g) => (
        <section key={g.category} aria-labelledby={`h-${g.category}`}><h2 id={`h-${g.category}`}>{g.category}</h2>
          <div className="lib-cards">{g.items.map((e) => <Link key={e.slug} href={`/library/components/${e.slug}`} className="lib-card"><b>{e.title} {e.status !== "stable" ? <em className={`lib-badge ${e.status}`}>{e.status}</em> : null}</b><span>{e.description}</span></Link>)}</div></section>
      ))}
      <p className="lib-note">{entries.length} component pages. The same files are published as a registry at <Link href="/r/registry.json">/r/registry.json</Link>.</p>
    </article>
  );
}
