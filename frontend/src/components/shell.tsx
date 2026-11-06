"use client";
import { Icon, Avatar, Button, IconButton, Popover, PopoverClose, Switch, Tooltip } from "@/ui";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Overlay, AppToast } from "./overlay";
import {
  A, S, useS, useMounted, tod, me, adminAttention, setNavigator, startLive, openPal, closeOv, palMove, runPal, NAV_ROLES,
} from "@/lib/store";
import { NAV } from "@/lib/data";
import { signOut } from "@/lib/auth";

const VIEW_BY_PATH: Record<string, string> = { "/": "home", "/rooms": "rooms", "/automate": "build", "/admin": "admin" };

function Ago() {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  return <b className="num">{Math.max(0, Math.floor((Date.now() - S.sync) / 1000))}</b>;
}

export function Shell({ children }: { children: ReactNode }) {
  useS();
  const router = useRouter(), pathname = usePathname(), mounted = useMounted();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = mounted && resolvedTheme === "dark";
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
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      document.body.classList.toggle("hgone", y > 150);
      // the Ask Alice button steps aside while reading downward and returns on the way up
      if (Math.abs(y - last) > 6) { document.body.classList.toggle("fab-away", y > last && y > 200); last = y; }
    };
    const onVis = () => document.documentElement.toggleAttribute("data-hidden", document.hidden);
    document.addEventListener("visibilitychange", onVis);
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
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("keydown", onKey); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const att = mounted ? adminAttention() : 0, p = me();
  const items = NAV.filter((n) => !("roles" in n) || (n.roles as readonly string[]).includes(S.role));

  return (
    <>
      <div className="app" id="app" data-tod={mounted ? tod() : "day"}>
        <aside className="rail">
          <div className="brand">alice<i>.</i></div>
          <nav className="nav" aria-label="Main">{items.map((n) => (
            <Link key={n.k} href={n.href} aria-current={view === n.k ? "page" : undefined}>
                            <Icon n={n.ic} /><span>{n.n}</span>{n.k === "admin" && att ? <span className="badge">{att}</span> : null}
            </Link>
          ))}</nav>
          <div className="rail-foot">
            <div className="me"><Avatar initial={p.n[0] ?? "·"} tone={p.c} /><div><b>{p.n}</b><small>{(p.role[0] ?? "m").toUpperCase() + p.role.slice(1)} · passkey</small></div>
              <Tooltip label="Sign out"><IconButton aria-label="Sign out" style={{ marginLeft: "auto" }} onClick={() => void signOut()}><Icon n="exit" /></IconButton></Tooltip></div>
          </div>
        </aside>
        <div className="main">
          <div className="top">
            <div className="brand">alice<i>.</i></div>
            <button className="ask" onClick={openPal} aria-label="Ask Alice or search"><Icon n="search" /><span>Try “turn off the kitchen lights”</span><kbd>Ctrl K</kbd></button>
            <div className="live"><i /><span className="lt">Live · synced {mounted ? <Ago /> : <b className="num">0</b>}s ago</span></div>
            <Tooltip label={dark ? "Switch to light" : "Switch to dark"} side="bottom"><IconButton aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(dark ? "light" : "dark")}><Icon n={dark ? "sun" : "moon"} /></IconButton></Tooltip>
            {/* The side rail with Sign out is hidden on a phone, so the phone gets its own way to sign out. */}
            <span className="me-phone"><Popover trigger={<IconButton aria-label={`${p.n}: account`}><Avatar initial={p.n[0]} tone={p.c} /></IconButton>} title={p.n} align="end">
              <p className="small">{(p.role[0] ?? "m").toUpperCase() + p.role.slice(1)} · passkey</p>
              {p.role !== "guest" ? <>
                <label className="field" style={{ justifyContent: "space-between" }}><span>Push notifications</span><Switch checked={S.push} label="Push notifications" onChange={A.push} /></label>
                <label className="field" style={{ justifyContent: "space-between" }}><span>Quiet hours</span><Switch checked={S.quiet} label="Quiet hours" onChange={A.quiet} /></label>
              </> : null}
              <PopoverClose render={<Button size="sm" onClick={() => void signOut()} />}><Icon n="exit" c="sm" />Sign out</PopoverClose>
            </Popover></span>
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
