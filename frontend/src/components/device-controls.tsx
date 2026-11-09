"use client";
import { useState, type ComponentType } from "react";
import { Bar } from "@/ui";
import { Cam } from "./camera";
import { Button, Nudge, Icon, Slider, Segmented, ColorWheel, WhiteStrip, CoverShade, Dial } from "@/ui";
import { kelvinToRgb, css } from "@/lib/color";
import { A } from "@/lib/store";
import type { Dev } from "@/lib/data";

/** Brightness slider bound to a dimmable device. */
export function DevSlider({ d, size }: { d: Dev; size?: "md" | "xl" }) {
  return <Slider value={d.v!} resetValue={100} size={size} label={`${d.n} brightness`} onChange={(v) => A.slide(d.id, v)} />;
}

/** Lock or unlock button. Unlocking asks for a passkey first. */
export function LockButton({ d }: { d: Dev }) {
  return (
    <Button size="sm" onClick={() => (d.locked ? A.unlock(d.id) : A.lock(d.id))}>
      <Icon n={d.locked ? "unlock" : "lock"} c="sm" />{d.locked ? "Unlock" : "Lock"}
    </Button>
  );
}

/** The colour a lamp is glowing, for its tile; undefined when it has no colour of its own to show. */
export function lampTint(d: Dev) {
  if (d.cm === "color" && d.rgb) return css(d.rgb as [number, number, number]);
  if (d.k) return css(kelvinToRgb(d.k));
  return undefined;
}

const MOODS: { n: string; k?: number; rgb?: [number, number, number]; b: number }[] = [
  { n: "Candle", k: 2200, b: 35 }, { n: "Reading", k: 3000, b: 80 }, { n: "Focus", k: 5000, b: 100 }, { n: "Movie", rgb: [255, 90, 40], b: 25 },
];

/** Colour and white controls for a lamp, shown only for what the lamp can do. */
export function LampColour({ d }: { d: Dev }) {
  const color = d.ops?.includes("set_color") ?? false, white = d.kmin !== undefined && (d.ops?.includes("set_color_temperature") ?? false);
  const [mode, setMode] = useState<"color" | "white">(color && (d.cm !== "white" || !white) ? "color" : "white");
  if (!color && !white) return null;
  const mid = d.kmin !== undefined ? Math.round((d.kmin + d.kmax!) / 2) : 3000;
  const moods = MOODS.filter((m) => (m.rgb ? color : white));
  return (
    <>
      {color && white ? <Segmented className="seg-full" value={mode} label="Colour or white" items={[["color", "Colour"], ["white", "White"]]} onChange={setMode} /> : null}
      {mode === "color" && color ? <ColorWheel rgb={(d.rgb as [number, number, number]) ?? [255, 200, 120]} label={`${d.n} colour`} onCommit={(c) => A.color(d.id, c)} />
        : <div style={{ paddingTop: 22 }}><WhiteStrip kelvin={d.k ?? mid} min={d.kmin!} max={d.kmax!} label={`${d.n} colour temperature`} onCommit={(k) => A.kelvin(d.id, k)} /></div>}
      <div className="moods">
        {moods.map((m) => (
          <button key={m.n} className="btn" onClick={() => {
            if (m.rgb) A.color(d.id, m.rgb); else A.kelvin(d.id, Math.min(d.kmax!, Math.max(d.kmin!, m.k!)));
            A.preset(d.id, m.b); setMode(m.rgb ? "color" : "white");
          }}>
            <i className="sw" style={{ background: css(m.rgb ?? kelvinToRgb(m.k!)) }} />{m.n}
          </button>
        ))}
      </div>
    </>
  );
}

/** Open, stop and close, plus a draggable shade when the cover reports a position. */
export function CoverControl({ d }: { d: Dev }) {
  const ops = d.ops ?? [], can = (o: string) => ops.includes(o);
  return (
    <>
      <div className="sbig" style={{ fontSize: "2.6rem" }}>{d.mv ? (d.mv === "opening" ? "Opening…" : "Closing…") : d.pos !== undefined && d.pos > 0 && d.pos < 100 ? `${d.pos}% open` : d.open ? "Open" : "Closed"}</div>
      {can("set_position") && d.pos !== undefined ? <CoverShade pos={d.pos} moving={!!d.mv} label={`${d.n} position`} onCommit={(p) => A.pos(d.id, p)} /> : null}
      {can("set_position") && d.pos !== undefined ? <Nudge label={`${d.n} opening`} minusDisabled={d.pos <= 0} plusDisabled={d.pos >= 100}
        onMinus={() => A.pos(d.id, Math.max(0, d.pos! - 10))} onPlus={() => A.pos(d.id, Math.min(100, d.pos! + 10))} /> : null}
      <div className="cbtns">
        {can("open") ? <Button onClick={() => A.cover(d.id, "open")}><Icon n="chev" c="sm" />Open</Button> : null}
        {can("stop") ? <Button onClick={() => A.cover(d.id, "stop")}>Stop</Button> : null}
        {can("close") ? <Button onClick={() => A.cover(d.id, "close")}>Close</Button> : null}
      </div>
    </>
  );
}

const MODE_NAME: Record<string, string> = { off: "Off", cool: "Cool", heat: "Heat", auto: "Auto", heat_cool: "Auto", dry: "Dry", fan_only: "Fan" };

/** Thermostat: a dial for the target with the room's temperature marked on it, and the modes the unit has. */
export function ClimateControl({ d }: { d: Dev }) {
  const min = d.tmin ?? 16, max = d.tmax ?? 30, step = d.tstep ?? 0.5, modes = d.hmodes ?? [];
  const col = d.hm === "heat" ? "rgb(255 150 60)" : d.hm === "cool" ? "rgb(90 160 255)" : undefined;
  return (
    <>
      <Dial value={d.tgt ?? 22} min={min} max={max} step={step} marker={d.cur} color={col} unit="°" label={`${d.n} target temperature`} onCommit={(t) => A.setTgt(d.id, t)}>
        {(v) => <><b className="num">{v % 1 ? v.toFixed(1) : v}°</b><small>now {d.cur?.toFixed(1)}° · {d.on ? "target" : "off"}</small></>}
      </Dial>
      <Nudge label={`${d.n} target`} minusDisabled={(d.tgt ?? min) <= min} plusDisabled={(d.tgt ?? max) >= max}
        onMinus={() => A.setTgt(d.id, Math.max(min, +((d.tgt ?? min) - step).toFixed(2)))} onPlus={() => A.setTgt(d.id, Math.min(max, +((d.tgt ?? min) + step).toFixed(2)))} />
      {modes.length > 1 ? <Segmented className="seg-full" value={d.hm ?? "off"} label="Mode" items={modes.map((m) => [m, MODE_NAME[m] ?? m] as const)} onChange={(m) => A.hvac(d.id, m)} /> : null}
    </>
  );
}

/** Fan: a dial for speed (all the way down is off), oscillation, and the unit's own presets. */
export function FanControl({ d }: { d: Dev }) {
  const ops = d.ops ?? [], pct = d.on ? d.pct ?? d.sp! * 33 : 0;
  const step = d.fstep && d.fstep > 0 ? d.fstep : 100 / 3;
  return (
    <>
      <Dial value={pct} min={0} max={100} step={Math.round(step * 100) / 100} unit="%" label={`${d.n} speed`} onCommit={(p) => A.fanPct(d.id, Math.round(p))}>
        {(v) => <><b className="num">{Math.round(v)}%</b><small>{v <= 0 ? "off" : "speed"}</small></>}
      </Dial>
      <Nudge label={`${d.n} speed`} minusDisabled={!d.on} plusDisabled={pct >= 100}
        onMinus={() => A.fanPct(d.id, Math.max(0, Math.round(pct - step)))} onPlus={() => A.fanPct(d.id, Math.min(100, Math.round(pct + step)))} />
      {ops.includes("set_oscillation") ? <Button aria-pressed={!!d.osc} onClick={() => A.osc(d.id, !d.osc)}><Icon n="refresh" c="sm" />{d.osc ? "Oscillating" : "Oscillate"}</Button> : null}
      {d.fpresets?.length ? <div className="chips">{d.fpresets.map((p) => <Button key={p} aria-pressed={d.fp === p} onClick={() => A.fanPreset(d.id, p)}>{p}</Button>)}</div> : null}
    </>
  );
}

/* ---------- the sheet: one entry per kind of device ---------- */
function LightControl({ d }: { d: Dev }) {
  return (
    <>
      <div className="sbig"><span>{d.on ? d.v : 0}%</span></div>
      {d.on ? null : <small>Off · last at {d.v}%</small>}
      <DevSlider d={d} size="xl" />
      <Nudge label={`${d.n} brightness`} minusDisabled={!d.on} plusDisabled={d.on && (d.v ?? 0) >= 100}
        onMinus={() => A.drag(d.id, Math.max(0, (d.v ?? 0) - 5))} onPlus={() => A.drag(d.id, Math.min(100, (d.on ? d.v ?? 0 : 0) + 5))} />
      <div className="presets">{[25, 50, 75, 100].map((n) => <button key={n} className="btn" onClick={() => A.preset(d.id, n)}>{n}%</button>)}</div>
      <LampColour d={d} />
    </>
  );
}
function PlugControl({ d }: { d: Dev }) {
  return (
    <>
      <div className="sbig">{d.on ? d.w!.toLocaleString() : 0}<small>W now</small></div>
      {d.limit ? <><Bar percent={Math.min(100, Math.round((d.w! / d.limit) * 100))} warn={d.w! / d.limit >= 0.9} /><small>Alice alerts you at 90% of {d.limit.toLocaleString()} W</small></> : null}
    </>
  );
}
function LockControl({ d }: { d: Dev }) {
  return (
    <>
      <div className="sbig" style={{ fontSize: "2.6rem" }}>{d.locked ? "Locked" : "Unlocked"}</div>
      <small>by {d.by || "someone"}, {d.at || ""}</small>
      <Button variant={d.locked ? "primary" : "sage"} className="sbtn" haptic={d.locked ? "light" : "medium"} onClick={() => (d.locked ? A.unlock(d.id) : A.lock(d.id))}><Icon n={d.locked ? "unlock" : "lock"} />{d.locked ? "Unlock with passkey" : "Lock"}</Button>
    </>
  );
}
function ContactControl({ d }: { d: Dev }) {
  return (
    <>
      <span className={`pill ${d.open ? "warn" : "ok"}`} style={{ alignSelf: "flex-start" }}><Icon n={d.open ? "alert" : "check"} c="sm" />{d.open ? "Open" : "Closed"}</span>
      <small>Changed 2 hours ago. Alice tells you if it stays open.</small>
    </>
  );
}
const PlainControl = ({ d }: { d: Dev }) => <small>{d.on ? "On" : "Off"}</small>;

/** What the device sheet shows for each kind of device, and whether it gets the Turn on/off button. */
const SHEET: Partial<Record<Dev["t"], { body: ComponentType<{ d: Dev }>; power?: boolean }>> = {
  dim: { body: LightControl, power: true }, light: { body: PlainControl, power: true }, plug: { body: PlugControl, power: true },
  fan: { body: FanControl, power: true }, climate: { body: ClimateControl, power: true },
  cover: { body: CoverControl }, lock: { body: LockControl }, contact: { body: ContactControl }, camera: { body: ({ d }) => <Cam d={d} /> },
};
export const sheetFor = (d: Dev) => SHEET[d.t] ?? { body: PlainControl, power: false };
