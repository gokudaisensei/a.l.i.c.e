import Link from "next/link";
import type { ReactNode } from "react";
import { byCategory, foundations } from "../registry";
import { Nav, type NavGroup } from "./nav";
import { ThemeToggle } from "./theme-toggle";

/** The docs frame: a header, the sidebar, and the page. */
export function LibraryShell({ children }: { children: ReactNode }) {
  const groups: NavGroup[] = [
    { title: "Foundations", items: foundations.map((f) => ({ href: `/library/foundations/${f.slug}`, title: f.title })) },
    ...byCategory().map((g) => ({ title: g.category, items: g.items.map((e) => ({ href: `/library/components/${e.slug}`, title: e.title, status: e.status })) })),
  ];
  return (
    <div className="lib-app">
      <header className="lib-top">
        <Link href="/library" className="lib-brand"><span className="brand">alice<i>.</i></span><span>Library</span></Link>
        <span className="lib-spacer" />
        <ThemeToggle />
      </header>
      <div className="lib-body">
        <Nav groups={groups} />
        <main id="main" className="lib-main">{children}</main>
      </div>
    </div>
  );
}
