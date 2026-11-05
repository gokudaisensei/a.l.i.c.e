"use client";
import { Icon, Button, IconButton, Pill, Switch, OptionButton, Empty, Safe, PageHeader, TileHeader, resetTileOrder } from "@/ui";
import type { ReactNode } from "react";
import {
  A, S, useS, usePhone, useMounted, bump, sumParts, joinL, VERBS, TRIG, setTrigger, builderAdd, builderSave, builderTest,
} from "@/lib/store";
import { MODES, ROOMS } from "@/lib/data";

const O = (v: string, t: string) => <option key={v} value={v}>{t}</option>;

const Wrap = ({ l, children }: { l: string; children: ReactNode }) => <label className="field"><span className="small" style={{ minWidth: 48 }}>{l}</span>{children}</label>;
const toggleStep = (k: string) => { S.bstep = S.bstep === k ? null : k; bump(); };
function Acc({ k, P, st, children }: { k: string; P: boolean; st: string | null; children: ReactNode }) {
  return <section className={P ? `tile acc ${st === k ? "open" : ""}` : "tile"}>{children}</section>;
}
function Hd({ k, cls, label, text, P, st }: { k: string; cls: string; label: string; text: string; P: boolean; st: string | null }) {
  return (
    <div className="sh" {...(P ? { onClick: () => toggleStep(k), role: "button", tabIndex: 0, "aria-expanded": st === k, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleStep(k); } } } : {})}>
      <span className={`tag ${cls}`}>{label}</span><span className="echo">{text}</span>{P ? <Icon n="chev" c="sm accv" /> : null}
    </div>
  );
}

function TrigParam() {
  const b = S.b, k = TRIG.find((x) => x.k === b.trig.k)!, p = (b.trig.p ?? "") as string;
  const setP = (v: string) => { b.trig.p = v; bump(); };
  if (k.p === "person") return <Wrap l="Who"><select className="sel" value={p} onChange={(e) => setP(e.target.value)}>{O("anyone", "Anyone")}{S.people.filter((x) => x.role !== "guest").map((x) => O(x.id, x.n))}</select></Wrap>;
  if (k.p === "time") return <Wrap l="Time"><input className="inp" type="time" value={p} onChange={(e) => setP(e.target.value)} /></Wrap>;
  if (k.p === "contact") return <Wrap l="Which"><select className="sel" value={p} onChange={(e) => setP(e.target.value)}>{S.devices.filter((d) => d.t === "contact").map((d) => O(d.id, d.n))}</select></Wrap>;
  if (k.p === "room") return <Wrap l="Where"><select className="sel" value={p} onChange={(e) => setP(e.target.value)}>{ROOMS.map((r) => O(r.id, r.n))}</select></Wrap>;
  if (k.p === "plug") return <Wrap l="Which"><select className="sel" value={p} onChange={(e) => setP(e.target.value)}>{S.devices.filter((d) => d.t === "plug" && d.limit).map((d) => O(d.id, d.n))}</select></Wrap>;
  return null;
}

function ActRow({ i }: { i: number }) {
  const a = S.b.acts[i], v = VERBS[a.v];
  return (
    <div className="arow">
      <span className="verb"><Icon n={v.ic} />{v.n}</span>
      <select className="sel" aria-label="Choose target" value={a.t} onChange={(e) => { a.t = e.target.value; bump(); }}>{v.pick().map((o) => O(o.id, o.n))}</select>
      {v.val ? <>
        <input className="inp" type="number" style={{ width: 84 }} min={v.val.min} max={v.val.max} value={a.n} aria-label="Value"
          onChange={(e) => { a.n = Math.min(v.val!.max, Math.max(v.val!.min, +e.target.value || v.val!.def)); bump(); }} />
        <span className="small">{v.val.u}</span></> : null}
      <IconButton style={{ marginLeft: "auto" }} aria-label="Remove this action" onClick={() => { S.b.acts.splice(i, 1); bump(); }}><Icon n="trash" /></IconButton>
    </div>
  );
}

function Sum() {
  const { w, c, a } = sumParts();
  return (
    <>
      <mark className="mw">When {w}</mark>
      {c.length ? <>, <mark className="mi">if {joinL(c)}</mark></> : null}
      {", "}
      {a.length ? <mark className="mt">{joinL(a)}</mark> : <span className="muted">add an action to finish the sentence</span>}.
    </>
  );
}

export function BuildView() {
  useS();
  const P = usePhone(), mounted = useMounted();
  if (!mounted) return null;
  resetTileOrder();
  const b = S.b, c = b.conds, { w, c: cc, a } = sumParts(), st = S.bstep;
  const whenS = (
    <Acc k="when" P={P} st={st}><Hd k="when" cls="w" label="When" text={"When " + w} P={P} st={st} />
      <div className="opts">{TRIG.map((x) => <OptionButton key={x.k} aria-pressed={x.k === b.trig.k} onClick={() => setTrigger(x.k)}><Icon n={x.ic} />{x.n}</OptionButton>)}</div>
      <TrigParam />
    </Acc>
  );
  const ifS = (
    <Acc k="if" P={P} st={st}><Hd k="if" cls="i" label="If" text={cc.length ? "Only if " + joinL(cc) : "Always. No conditions."} P={P} st={st} />
      <div className="opts">
        <OptionButton aria-pressed={c.dark} onClick={() => { c.dark = !c.dark; bump(); }}><Icon n="moon" />Only when it is dark</OptionButton>
        <OptionButton aria-pressed={c.home} onClick={() => { c.home = !c.home; bump(); }}><Icon n="home" />Only when someone is home</OptionButton>
      </div>
      <div className="field">
        <label className="field"><span className="small">Days</span><select className="sel" value={c.days} onChange={(e) => { c.days = e.target.value; bump(); }}>{O("any", "Any day")}{O("weekdays", "Weekdays")}{O("weekends", "Weekends")}</select></label>
        <label className="field"><span className="small">Mode</span><select className="sel" value={c.mode} onChange={(e) => { c.mode = e.target.value; bump(); }}>{O("any", "Any mode")}{MODES.map((m) => O(m.k, m.k))}</select></label>
      </div>
    </Acc>
  );
  const thenS = (
    <Acc k="then" P={P} st={st}><Hd k="then" cls="t" label="Then" text={`${a.length} action${a.length === 1 ? "" : "s"}`} P={P} st={st} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {b.acts.length ? b.acts.map((_, i) => <ActRow key={i} i={i} />) : <Empty>No actions yet. Add one below.</Empty>}
      </div>
      <div className="small">Add an action</div>
      <div className="opts">
        {Object.entries(VERBS).map(([k, v]) => <OptionButton key={k} onClick={() => builderAdd(k)}><Icon n="plus" c="sm" />{v.n}</OptionButton>)}
        <OptionButton disabled aria-disabled="true"><Icon n="unlock" />Unlock a door</OptionButton>
      </div>
      <Safe items={[{ icon: "shieldcheck", text: "Unlocking is never allowed in an automation. Alice can lock a door for you, but only a person with a passkey can open one." }]} />
    </Acc>
  );
  const sumS = (
    <section className="tile t-sage" id="t-sum">
      {P ? null : <TileHeader title="In plain English" eyebrow={<><Icon n="sparkle" c="sm" /> Live preview</>} />}
      <p className="sentence"><Sum /></p>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="small">Name</span>
        <input className="inp" style={{ width: "100%" }} value={b.name} placeholder="Name this automation" onChange={(e) => { b.name = e.target.value; bump(); }} /></label>
      <div className="btns"><Button variant="primary" onClick={builderSave}><Icon n="check" c="sm" />Save to Home Assistant</Button><Button onClick={builderTest}>Dry run</Button></div>
      <Safe items={["Runs inside Home Assistant, not in Alice.", "Appears in the household log with your name."]} />
    </section>
  );
  const list = (
    <div>{S.autos.map((x) => (
      <div key={x.id} className="auto">
        <div><b>{x.n}</b></div>
        <Switch checked={x.on} label={x.n} onChange={() => A.autotog(x.id)} />
        <p>{x.s}</p>
        <small className="mono" style={{ gridColumn: "1/3" }}>Last run: {x.last}</small>
      </div>
    ))}</div>
  );
  const onCount = S.autos.filter((x) => x.on).length;
  const autoS = P ? (
    <section className={`tile acc ${st === "auto" ? "open" : ""}`}>
      <div className="sh" role="button" tabIndex={0} aria-expanded={st === "auto"} onClick={() => toggleStep("auto")}>
        <h3 className="tt">Your automations</h3><Pill>{onCount} on</Pill><Icon n="chev" c="sm accv" />
      </div>
      {list}
    </section>
  ) : (
    <section className="tile"><TileHeader title="Your automations" right={<Pill>{onCount} on</Pill>} />{list}</section>
  );

  return (
    <>
      <PageHeader title="Automate">Pick what starts it, what must be true, and what happens. Alice writes it into Home Assistant, so it keeps running even if Alice is offline.</PageHeader>
      {P ? (
        <div className="bgrid" style={{ display: "flex", flexDirection: "column" }}>{sumS}{whenS}{ifS}{thenS}{autoS}</div>
      ) : (
        <div className="bgrid">
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{whenS}{ifS}{thenS}</div>
          <div className="sticky">{sumS}{autoS}</div>
        </div>
      )}
    </>
  );
}
