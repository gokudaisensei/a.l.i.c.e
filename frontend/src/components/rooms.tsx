"use client";
import { useEffect, useRef } from "react";
import { Icon, Button, IconButton, StepButton, Tooltip, Pill, FilterChip, Switch, Segmented, Bar, Empty, PageHeader, resetTileOrder } from "@/ui";
import { LockButton, DevSlider } from "./device-controls";
import { DTile } from "./home";
import { A, S, useS, usePhone, useMounted, vis, isOn, icn, rname, nowS, bump } from "@/lib/store";
import { ROOMS, type Dev } from "@/lib/data";
import { loadHidden, setHidden } from "@/lib/live";

const CAN = ["dim", "light", "plug", "fan", "climate", "other"];

export function Cam({ d }: { d: Dev }) {
  return (
    <div className="cam">
      <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0 62 L40 46 L84 58 L120 40 L160 54 V90 H0Z" fill="#fff" /></svg>
      <span className="rec"><i />LIVE</span><span className="tag">{d.n} · {nowS()}</span>
    </div>
  );
}

function DCard({ d }: { d: Dev }) {
  const on = isOn(d), wide = d.t === "camera";
  let body: React.ReactNode = null;
  if (d.t === "dim") body = d.on
    ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}><DevSlider d={d} /><b className="num" style={{ minWidth: 42, textAlign: "right" }}>{d.v}%</b></div>
    : <div className="small">Off · last at {d.v}%</div>;
  else if (d.t === "light" || d.t === "other") body = <div className="small">{d.on ? "On" : "Off"} · {d.kind ?? "on/off only"}</div>;
  else if (d.t === "plug") {
    const p = d.limit ? Math.round((d.w! / d.limit) * 100) : 0;
    body = <>
      <div className="small"><b className="num" style={{ color: "var(--ink)" }}>{d.on ? d.w!.toLocaleString() : 0} W</b> now</div>
      {d.limit ? <><Bar percent={Math.min(p, 100)} warn={p >= 90} /><div className="small">Alert at 90% of {d.limit.toLocaleString()} W</div></> : null}
    </>;
  } else if (d.t === "fan") body = (
    <Segmented value={d.on ? d.sp! : 0} label="Fan speed" items={[[1, "1"], [2, "2"], [3, "3"]]} onChange={(n) => A.fan(d.id, n)} />
  );
  else if (d.t === "climate") body = (
    <div className="temp">
      <div><b className="num" style={{ fontSize: 26 }}>{d.cur!.toFixed(1)}°</b><div className="small">now</div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StepButton style={{ background: "var(--tile2)" }} onClick={() => A.tgt(d.id, -1)} aria-label="Lower target"><Icon n="minus" /></StepButton>
        <b className="num" style={{ minWidth: 34, textAlign: "center" }}>{d.tgt}°</b>
        <StepButton style={{ background: "var(--tile2)" }} onClick={() => A.tgt(d.id, 1)} aria-label="Raise target"><Icon n="plus" /></StepButton>
      </div>
    </div>
  );
  else if (d.t === "lock") body = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div><b>{d.locked ? "Locked" : "Unlocked"}</b><div className="small">{d.by || ""}, {d.at || ""}</div></div><LockButton d={d} />
    </div>
  );
  else if (d.t === "camera") body = <><Cam d={d} /><div className="btns"><Button size="sm" onClick={() => A.live(d.id)}><Icon n="eye" c="sm" />Open live view</Button></div></>;
  else if (d.t === "contact") body = <div><span className={`pill ${d.open ? "warn" : "ok"}`}><Icon n={d.open ? "alert" : "check"} c="sm" />{d.open ? "Open" : "Closed"}</span> <span className="small">Changed 2 h ago</span></div>;

  let foot: React.ReactNode;
  if (S.role === "admin") {
    const can = CAN.includes(d.t);
    foot = d.t === "lock"
      ? <span className="voice" title="Locks are never exposed to voice assistants"><Icon n="lock" c="sm" />Never by voice</span>
      : can ? <button className="voice" aria-pressed={!!d.voice} onClick={() => A.voice(d.id)}><Icon n="mic" c="sm" />{d.voice ? "Alexa · Google" : "Voice off"}</button>
        : <span />;
  } else foot = <span />;

  return (
    <div className={`dcard ${on ? "is-on" : ""} ${wide ? "wide" : ""}`}>
      <div className="dc-h">
        <span className="dico"><Icon n={icn(d)} /></span>
        <div className="grow name"><b>{d.n}</b><small>{S.group === "room" ? d.hw : rname(d.r)}</small></div>
        {CAN.includes(d.t) ? <Switch checked={!!d.on} label={d.n} onChange={() => A.tog(d.id)} /> : null}
      </div>
      {body}
      <div className="dc-f">
        {foot}
        {S.role !== "guest" ? <Tooltip label="Rename or hide"><IconButton aria-label={`Rename or hide ${d.n}`} onClick={() => A.editDev(d.id)}><Icon n="note" /></IconButton></Tooltip> : null}
        <Tooltip label={`${d.fav ? "Remove from" : "Add to"} favourites`}><button className={`icon-btn ${d.fav ? "on" : ""}`} aria-pressed={!!d.fav} aria-label={`${d.fav ? "Remove from" : "Add to"} favourites`} onClick={() => A.fav(d.id)}><Icon n="star" /></button></Tooltip>
      </div>
    </div>
  );
}

function Results({ phone }: { phone: boolean }) {
  const q = S.q.trim().toLowerCase();
  const list = vis().filter((d) => (S.room === "all" || d.r === S.room) && (!q || (d.n + " " + rname(d.r) + " " + d.hw).toLowerCase().includes(q)) && (!S.voiceOnly || d.voice));
  if (!list.length) return <Empty style={{ marginTop: 14 }}>Nothing matches. Try a room name, a device, or clear the filters.</Empty>;
  const groups: { h: string; g: Dev[]; m: string; on?: boolean }[] = [];
  if (S.group === "room") ROOMS.forEach((r) => { const g = list.filter((d) => d.r === r.id); if (g.length) groups.push({ h: r.n, g, m: `${g.filter(isOn).length} of ${g.length} active` }); });
  else [...new Set(list.map((d) => d.hw))].forEach((h) => { const g = list.filter((d) => d.hw === h); groups.push({ h, g, m: `${g.length} device${g.length > 1 ? "s" : ""}`, on: true }); });
  return <>{groups.map((x) => phone ? (
    <div key={x.h}>
      <div className="gh"><h2>{x.h}</h2><span className="small">{x.m}</span></div>
      <div className="pg3" style={{ gridColumn: "auto" }}>{x.g.map((d) => <DTile key={d.id} d={d} hideRoom={S.group === "room"} />)}</div>
    </div>
  ) : (
    <div key={x.h}>
      <div className="gh"><h2>{x.h}</h2>{x.on ? <Pill tone="ok" icon="check">Online</Pill> : null}<span className="small">{x.m}</span></div>
      <div className="dgrid">{x.g.map((d) => <DCard key={d.id} d={d} />)}</div>
    </div>
  ))}</>;
}

function Hidden() {
  return (
    <section style={{ marginTop: 24 }}>
      <div className="gh"><h2>Hidden</h2><span className="small">{S.hiddenDevs.length} device{S.hiddenDevs.length === 1 ? "" : "s"} you hid from Alice</span></div>
      <div className="list">{S.hiddenDevs.map((h) => (
        <div key={h.id} className="row"><span className="dico"><Icon n="eye" /></span><div><b>{h.n}</b></div><Button size="sm" onClick={() => void setHidden(h.id, false)}>Show again</Button></div>
      ))}</div>
    </section>
  );
}

export function RoomsView() {
  useS();
  const results = useRef<HTMLDivElement>(null), filters = useRef<HTMLDivElement>(null);
  useEffect(() => { if (S.role === "admin") void loadHidden(); }, []);
  const phone = usePhone(), mounted = useMounted();
  if (!mounted) return null;
  resetTileOrder();
  const all = vis(), rs = ROOMS.filter((r) => all.some((d) => d.r === r.id)), vc = all.filter((d) => d.voice).length;

  /**
   * Changes what the list shows without the page lurching. Swapping a long list for a short one used to collapse the page in
   * one frame and throw the scroll position to the top. Now the old height is held while the new list rises in, the page glides
   * up to the filters if it was scrolled below them, the chosen chip slides into view, and the held height is let go gently.
   */
  const swap = (change: () => void, chip?: HTMLElement | null) => {
    const el = results.current, reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el) { el.style.transition = "none"; el.style.minHeight = `${el.offsetHeight}px`; }
    chip?.scrollIntoView({ inline: "center", block: "nearest", behavior: reduced ? "auto" : "smooth" });
    change();
    requestAnimationFrame(() => {
      const top = filters.current ? filters.current.getBoundingClientRect().top + window.scrollY - 12 : 0;
      if (window.scrollY > top) window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    });
    if (el) setTimeout(() => { el.style.transition = reduced ? "none" : "min-height .3s var(--ease-out)"; el.style.minHeight = "0px"; setTimeout(() => { el.style.minHeight = ""; el.style.transition = ""; }, 340); }, reduced ? 0 : 380);
  };
  return (
    <>
      <PageHeader title={S.role === "guest" ? "Your rooms" : "Rooms"}>{S.role === "guest" ? "Only what Gokul has shared with you." : "Everything Alice can reach, grouped the way you think about it. Controls change to match what each device can do."}</PageHeader>
      <div ref={filters}><div className="scroller" role="group" aria-label="Filter by room">
        <FilterChip pressed={S.room === "all"} count={all.length} onClick={(e) => swap(() => { S.room = "all"; bump(); }, e.currentTarget)}>All</FilterChip>
        {rs.map((r) => <FilterChip key={r.id} pressed={S.room === r.id} count={all.filter((d) => d.r === r.id).length} onClick={(e) => swap(() => { S.room = r.id; bump(); }, e.currentTarget)}>{r.n}</FilterChip>)}
      </div></div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <label className="search"><Icon n="search" />
          <input type="search" placeholder="Search devices, rooms or hardware" value={S.q} aria-label="Search devices" onChange={(e) => { S.q = e.target.value; bump(); }} />
        </label>
        <Segmented value={S.group} label="Group by" items={[["room", "By room"], ["hw", "By hardware"]]} onChange={(v) => swap(() => { S.group = v; bump(); })} />
        {S.role === "admin" ? <FilterChip pressed={S.voiceOnly} icon="mic" count={vc} onClick={() => { S.voiceOnly = !S.voiceOnly; bump(); }}>Voice-enabled</FilterChip> : null}
      </div>
      {S.role === "admin" ? <p className="small" style={{ marginBottom: 4 }}>Voice items are shared with Alexa and Google through Home Assistant Cloud. Locks are never shared.</p> : null}
      <div ref={results} className="enterless"><div key={`${S.room}|${S.group}`} className="swap-in"><Results phone={phone} /></div></div>
      {S.hiddenDevs.length && S.role === "admin" ? <Hidden /> : null}
    </>
  );
}
