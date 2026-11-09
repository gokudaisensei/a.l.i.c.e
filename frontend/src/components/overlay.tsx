"use client";
import { Icon, Button, IconButton, Modal, BottomSheet, Toast, ConfirmDialog, Field, Input, Notice, haptic } from "@/ui";
import { renameDevice, setHidden } from "@/lib/live";
import { sheetFor } from "./device-controls";
import { useRef, useState } from "react";
import { A, S, useS, usePhone, dev, isOn, icn, rname, closeOv, pkRun, palQuery, runPal, bump, dismissToast } from "@/lib/store";
import type { Dev } from "@/lib/data";

function DeviceSheet({ d }: { d: Dev }) {
  const entry = sheetFor(d);
  const Body = entry.body;
  const can = entry.power;
  return (
    <>
      <div className="th">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="dico" style={isOn(d) ? { background: "var(--glow-soft)", color: "var(--glow-ink)" } : undefined}><Icon n={icn(d)} /></span>
          <div><h3 className="tt" style={{ fontSize: "1.375rem" }}>{d.n}</h3><small>{rname(d.r)} · {d.hw}</small></div>
        </div>
        <IconButton onClick={closeOv} aria-label="Close"><Icon n="x" /></IconButton>
      </div>
      <Body d={d} />
      {can ? <button className={`btn ${d.on ? "" : "btn--p"} sbtn`} onClick={() => A.tog(d.id)}><Icon n="bolt" c="sm" />{d.on ? "Turn off" : "Turn on"}</button> : null}
      <div className="sfoot">
        <Button onClick={() => A.fav(d.id)} aria-pressed={!!d.fav}><Icon n="star" c="sm" />{d.fav ? "In favourites" : "Add to favourites"}</Button>
        {S.role === "admin" && can ? <Button onClick={() => A.voice(d.id)}><Icon n="mic" c="sm" />{d.voice ? "Voice on" : "Voice off"}</Button> : null}
      </div>
    </>
  );
}

function Passkey({ k, open }: { k: NonNullable<typeof S.pk>; open: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <ConfirmDialog open={open} title={k.title} description={k.desc} state={k.state} onConfirm={pkRun} onCancel={closeOv} confirmRef={ref} />;
}

function Palette({ p, open }: { p: NonNullable<typeof S.pal>; open: boolean }) {
  const phone = usePhone();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) closeOv(); }} label="Ask Alice" initialFocus={ref}>
      <div className="pal-in"><Icon n="sparkle" />
        <input ref={ref} placeholder={phone ? "Ask Alice anything" : "Say it plainly, like “turn off the kitchen lights”"} autoComplete="off" aria-label="Ask Alice" value={p.q} onChange={(e) => palQuery(e.target.value)} />
        <kbd>Esc</kbd></div>
      <div className="pal-list">
        {p.q ? null : <div className="eyebrow pal-h">Try saying</div>}
        {p.items.map((it, i) => (
          <button key={i} className="pal-i" aria-current={i === p.sel} disabled={it.dis} onClick={() => { haptic("select"); runPal(i); }} onMouseMove={() => { if (p.sel !== i) { p.sel = i; bump(); } }}>
            <Icon n={it.ic} /><div className="grow"><b>{it.l}</b><small>{it.s || ""}</small></div>{it.k && i === p.sel ? <kbd>{it.k}</kbd> : null}
          </button>
        ))}
      </div>
      <div className="pal-f"><span>Up and down to choose</span><span>Enter to run</span><span>Every change can be undone</span></div>
    </Modal>
  );
}

/** Keep the last non-null value so a surface can finish its exit animation after the store has cleared it. */
function useLast<T>(v: T | null): T | null {
  const [last, setLast] = useState<T | null>(v);
  if (v && v !== last) setLast(v);
  return v ?? last;
}

/** Rename a device (or give it back its Home Assistant name) and hide it from the app. */
function DeviceEdit({ e, open }: { e: NonNullable<typeof S.edit>; open: boolean }) {
  const d = dev(e.id);
  const name = e.name.trim();
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) { S.edit = null; bump(); } }} label="Edit device" placement="center">
      <form className="edit-dev" onSubmit={(ev) => { ev.preventDefault(); if (name && d) { void renameDevice(e.id, name === d.n ? null : name); S.edit = null; bump(); } }}>
        <h2>Edit device</h2>
        <Field label="Name"><Input autoFocus value={e.name} maxLength={80} onChange={(ev) => { e.name = ev.target.value; bump(); }} /></Field>
        <Notice>Renaming changes what Alice shows. It never changes the name in Home Assistant.</Notice>
        <div className="btns">
          <Button variant="primary" type="submit" disabled={!name}>Save</Button>
          <Button onClick={() => { void renameDevice(e.id, null); S.edit = null; bump(); }}>Use Home Assistant’s name</Button>
          <Button variant="danger" onClick={() => { void setHidden(e.id, true); S.edit = null; bump(); }}>Hide from Alice</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Overlay() {
  useS();
  const live = S.sheet ? dev(S.sheet) : null;
  const d = useLast(live), pk = useLast(S.pk), pal = useLast(S.pal), ed = useLast(S.edit);
  return (
    <>
      {d ? <BottomSheet open={!!live} onOpenChange={(o) => { if (!o) closeOv(); }} label={`${d.n} controls`}><DeviceSheet d={d} /></BottomSheet> : null}
      {pal ? <Palette p={pal} open={!!S.pal} /> : null}
      {ed ? <DeviceEdit e={ed} open={!!S.edit} /> : null}
      {pk ? <Passkey k={pk} open={!!S.pk} /> : null}
    </>
  );
}

export function AppToast() {
  useS();
  const t = S.toast;
  return <Toast key={t.id} message={t.msg} title={t.title} tone={t.tone} show={t.show} onDismiss={dismissToast} onUndo={t.undo ? () => { const u = t.undo; dismissToast(); u?.(); } : undefined} />;
}
