"use client";
import { Icon, Segmented, Avatar } from "@/ui";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Overlay, AppToast } from "./overlay";
import {
  A, S, useS, useMounted, tod, me, adminAttention, setNavigator, startLive, openPal, closeOv, palMove, runPal, NAV_ROLES,
} from "@/lib/store";
import { NAV, type Role } from "@/lib/data";

const VIEW_BY_PATH: Record<string, string> = { "/": "home", "/rooms": "rooms", "/automate": "build", "/admin": "admin" };

function Ago() {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  return <b className="num">{Math.max(0, Math.floor((Date.now() - S.sync) / 1000))}</b>;
}

export function Shell({ children }: { children: ReactNode }) {
  useS();
  const router = useRouter(), pathname = usePathname(), mounted = useMounted();
  const view = VIEW_BY_PATH[pathname] ?? "home";
  S.view = view;
  // The entrance animation replays whenever the page or the role changes, then settles.
  const enterKey = `${pathname}|${S.role}`;
  const [settled, setSettled] = useState("");
  const enter = settled !== enterKey;

  useEffect(() => { setNavigator((p) => router.push(p)); }, [router]);
  useEffect(() => startLive(), []);

  useEffect(() => {
    const t = setTimeout(() => setSettled(enterKey), 1300);
    return () => clearTimeout(t);
  }, [enterKey]);

  // Roles that cannot see a page fall back to Home.
  useEffect(() => {
    const r = NAV_ROLES[view];
    if (r && !r.includes(S.role)) router.replace("/");
  });

  useEffect(() => {
    const onScroll = () => document.body.classList.toggle("hgone", window.scrollY > 150);
    const onKey = (e: KeyboardEvent) => {
      const open = !!(S.pk || S.pal || S.sheet);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (open && S.pal) closeOv(); else openPal(); return; }
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement?.tagName) ?? "") && !open) { e.preventDefault(); openPal(); return; }
      if (e.key === "Escape" && open) { closeOv(); return; }
      if (S.pal && open) {
        if (e.key === "ArrowDown") { e.preventDefault(); palMove(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); palMove(-1); }
        else if (e.key === "Enter") { e.preventDefault(); runPal(S.pal.sel); }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("keydown", onKey); };
  }, []);

  const att = mounted ? adminAttention() : 0, p = me();
  const items = NAV.filter((n) => !("roles" in n) || (n.roles as readonly string[]).includes(S.role));

  return (
    <>
      <div className="review">
        <span className="grp"><b>Design preview</b></span>
        <span className="grp"><b>View as</b>
          <Segmented value={S.role} items={[["admin", "Admin"], ["member", "Member"], ["guest", "Guest"]] as [Role, string][]} onChange={A.role} /></span>
        <span className="grp"><b>Time of day</b>
          <Segmented value={S.tod} items={[["auto", "Now"], ["morning", "Morning"], ["day", "Afternoon"], ["evening", "Evening"], ["night", "Night"]]} onChange={A.setTod} /></span>
      </div>
      <div className="app" id="app" data-tod={mounted ? tod() : "day"}>
        <aside className="rail">
          <div className="brand">alice<i>.</i></div>
          <nav className="nav" aria-label="Main">{items.map((n) => (
            <Link key={n.k} href={n.href} aria-current={view === n.k ? "page" : undefined}>
              <Icon n={n.ic} /><span>{n.n}</span>{n.k === "admin" && att ? <span className="badge">{att}</span> : null}
            </Link>
          ))}</nav>
          <div className="rail-foot">
            <div className="me"><Avatar initial={p.n[0]} tone={p.c} /><div><b>{p.n}</b><small>{p.role[0].toUpperCase() + p.role.slice(1)} · passkey</small></div></div>
          </div>
        </aside>
        <div className="main">
          <div className="top">
            <div className="brand">alice<i>.</i></div>
            <button className="ask" onClick={openPal} aria-label="Ask Alice or search"><Icon n="search" /><span>Try “turn off the kitchen lights”</span><kbd>Ctrl K</kbd></button>
            <div className="live"><i /><span className="lt">Live · synced {mounted ? <Ago /> : <b className="num">0</b>}s ago</span></div>
          </div>
          <main id="main" className={enter ? "enter" : ""}>{children}</main>
        </div>
      </div>
      <button className="fab" onClick={openPal} aria-label="Ask Alice"><Icon n="sparkle" /></button>
      <Overlay />
      <AppToast />
    </>
  );
}
