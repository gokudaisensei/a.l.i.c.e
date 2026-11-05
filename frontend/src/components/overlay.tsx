"use client";
import { Icon, Button, IconButton, StepButton, Bar, Scrim, Sheet, Toast, ConfirmDialog } from "@/ui";
import { DevSlider } from "./device-controls";
import { useEffect, useRef } from "react";
import { Cam } from "./rooms";
import { A, S, useS, dev, isOn, icn, rname, closeOv, pkRun, palQuery, runPal, bump } from "@/lib/store";
import type { Dev } from "@/lib/data";

const CAN = ["dim", "light", "plug", "fan", "climate"];

function DeviceSheet({ d }: { d: Dev }) {
  const can = CAN.includes(d.t);
  let b: React.ReactNode;
  if (d.t === "dim") b = <>
    <div className="sbig"><span>{d.on ? d.v : 0}%</span></div>
    {d.on ? null : <small>Off · last at {d.v}%</small>}
    <DevSlider d={d} size="xl" />
    <div className="presets">{[25, 50, 75, 100].map((n) => <button key={n} className="btn" onClick={() => A.preset(d.id, n)}>{n}%</button>)}</div>
  </>;
  else if (d.t === "plug") b = <>
    <div className="sbig">{d.on ? d.w!.toLocaleString() : 0}<small>W now</small></div>
    {d.limit ? <><Bar percent={Math.min(100, Math.round((d.w! / d.limit) * 100))} warn={d.w! / d.limit >= 0.9} /><small>Alice alerts you at 90% of {d.limit.toLocaleString()} W</small></> : null}
  </>;
  else if (d.t === "fan") b = (
    <div className="seg" style={{ width: "100%" }} role="group" aria-label="Fan speed">{[1, 2, 3].map((n) => (
      <button key={n} style={{ flex: 1, padding: 12 }} aria-pressed={!!d.on && d.sp === n} onClick={() => A.fan(d.id, n)}>Speed {n}</button>))}</div>
  );
  else if (d.t === "climate") b = <>
    <div className="temp"><div className="sbig">{d.cur!.toFixed(1)}°<small>now</small></div></div>
    <div className="temp">
      <StepButton style={{ width: 56, height: 56, background: "var(--tile2)" }} onClick={() => A.tgt(d.id, -1)} aria-label="Lower target"><Icon n="minus" /></StepButton>
      <div style={{ textAlign: "center" }}><b className="num" style={{ fontSize: 30 }}>{d.tgt}°</b><div className="small">target</div></div>
      <StepButton style={{ width: 56, height: 56, background: "var(--tile2)" }} onClick={() => A.tgt(d.id, 1)} aria-label="Raise target"><Icon n="plus" /></StepButton>
    </div>
  </>;
  else if (d.t === "lock") b = <>
    <div className="sbig" style={{ fontSize: "2.6rem" }}>{d.locked ? "Locked" : "Unlocked"}</div>
    <small>by {d.by || "someone"}, {d.at || ""}</small>
    <button className={`btn ${d.locked ? "btn--p" : "btn--sage"} sbtn`} onClick={() => (d.locked ? A.unlock(d.id) : A.lock(d.id))}><Icon n={d.locked ? "unlock" : "lock"} />{d.locked ? "Unlock with passkey" : "Lock"}</button>
  </>;
  else if (d.t === "contact") b = <>
    <span className={`pill ${d.open ? "warn" : "ok"}`} style={{ alignSelf: "flex-start" }}><Icon n={d.open ? "alert" : "check"} c="sm" />{d.open ? "Open" : "Closed"}</span>
    <small>Changed 2 hours ago. Alice tells you if it stays open.</small>
  </>;
  else if (d.t === "camera") b = <Cam d={d} />;
  else b = <small>{d.on ? "On" : "Off"}</small>;
  return (
    <Sheet bottom label={`${d.n} controls`}>
      <div className="th">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="dico" style={isOn(d) ? { background: "var(--glow-soft)", color: "var(--glow-ink)" } : undefined}><Icon n={icn(d)} /></span>
          <div><h3 className="tt" style={{ fontSize: 22 }}>{d.n}</h3><small>{rname(d.r)} · {d.hw}</small></div>
        </div>
        <IconButton onClick={closeOv} aria-label="Close"><Icon n="x" /></IconButton>
      </div>
      {b}
      {can ? <button className={`btn ${d.on ? "" : "btn--p"} sbtn`} onClick={() => A.tog(d.id)}><Icon n="bolt" c="sm" />{d.on ? "Turn off" : "Turn on"}</button> : null}
      <div className="sfoot">
        <Button onClick={() => A.fav(d.id)} aria-pressed={!!d.fav}><Icon n="star" c="sm" />{d.fav ? "In favourites" : "Add to favourites"}</Button>
        {S.role === "admin" && can ? <Button onClick={() => A.voice(d.id)}><Icon n="mic" c="sm" />{d.voice ? "Voice on" : "Voice off"}</Button> : null}
      </div>
    </Sheet>
  );
}

function Passkey() {
  const k = S.pk!;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 30); return () => clearTimeout(t); }, []);
  return <ConfirmDialog title={k.title} description={k.desc} state={k.state} onConfirm={pkRun} onCancel={closeOv} confirmRef={ref} />;
}

function Palette() {
  const p = S.pal!;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Sheet label="Ask Alice">
      <div className="pal-in"><Icon n="sparkle" />
        <input ref={ref} placeholder="Say it plainly, like “turn off the kitchen lights”" autoComplete="off" aria-label="Ask Alice" value={p.q} onChange={(e) => palQuery(e.target.value)} />
        <kbd>Esc</kbd></div>
      <div className="pal-list">
        {p.q ? null : <div className="eyebrow pal-h">Try saying</div>}
        {p.items.map((it, i) => (
          <button key={i} className="pal-i" aria-current={i === p.sel} disabled={it.dis} onClick={() => runPal(i)} onMouseMove={() => { if (p.sel !== i) { p.sel = i; bump(); } }}>
            <Icon n={it.ic} /><div className="grow"><b>{it.l}</b><small>{it.s || ""}</small></div>{it.k && i === p.sel ? <kbd>{it.k}</kbd> : null}
          </button>
        ))}
      </div>
      <div className="pal-f"><span>Up and down to choose</span><span>Enter to run</span><span>Every change can be undone</span></div>
    </Sheet>
  );
}

export function Overlay() {
  useS();
  const d = S.sheet ? dev(S.sheet) : null;
  const kind = S.pk ? "pk" : S.pal ? "pal" : d ? "sheet" : null;
  return (
    <Scrim open={!!kind} mode={kind === "sheet" ? "bottom" : kind === "pk" ? "center" : "top"} onDismiss={closeOv}>
      {kind === "sheet" && d ? <DeviceSheet d={d} /> : kind === "pk" ? <Passkey /> : kind === "pal" ? <Palette /> : null}
    </Scrim>
  );
}

export function AppToast() {
  useS();
  const t = S.toast;
  return <Toast message={t.msg} show={t.show} onUndo={t.undo ? () => { S.toast.show = false; const u = t.undo; bump(); u?.(); } : undefined} />;
}
