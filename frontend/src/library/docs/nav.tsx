"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui";

export interface NavGroup { title: string; items: { href: string; title: string; status?: string }[] }

/** The sidebar: foundations and components, with a filter. `/` focuses the filter. */
export function Nav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  // the menu is open for one page: going to another closes it, without an effect
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === path;
  const setOpen = useCallback((v: boolean | ((o: boolean) => boolean)) => setOpenAt((cur) => ((typeof v === "function" ? v(cur === path) : v) ? path : null)), [path]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "")) { e.preventDefault(); setOpen(true); input.current?.focus(); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [setOpen]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return groups.map((g) => ({ ...g, items: g.items.filter((i) => !n || i.title.toLowerCase().includes(n) || g.title.toLowerCase().includes(n)) })).filter((g) => g.items.length);
  }, [groups, q]);
  return (
    <>
      <button type="button" className="lib-menu-btn" aria-expanded={open} aria-controls="lib-nav" onClick={() => setOpen((o) => !o)}><Icon n="grid" c="sm" />Browse</button>
      <nav id="lib-nav" className="lib-nav" aria-label="Library" data-open={open || undefined}>
        <label className="lib-search"><Icon n="search" c="sm" /><span className="sr">Filter pages</span>
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter  ( / )" type="search" autoComplete="off" /></label>
        {shown.map((g) => (
          <div key={g.title} className="lib-group">
            <div className="lib-group-t">{g.title}</div>
            <ul>{g.items.map((i) => (
              <li key={i.href}><Link href={i.href} aria-current={path === i.href ? "page" : undefined}>{i.title}{i.status && i.status !== "stable" ? <em className={`lib-badge ${i.status}`}>{i.status}</em> : null}</Link></li>
            ))}</ul>
          </div>
        ))}
        {!shown.length ? <p className="lib-note">Nothing matches “{q}”.</p> : null}
      </nav>
    </>
  );
}
