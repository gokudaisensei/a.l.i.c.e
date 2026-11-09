"use client";
import { Icon, Button, Pill, Select, Switch, Input, Stepper, OptionButton, Empty, Safe, PageHeader, TileHeader, ActionRow, TimeField, Segmented } from "@/ui";
import type { ReactNode } from "react";
import {
  A, S, SCENES, useS, usePhone, useMounted, bump, sumParts, joinL, VERBS, VERBS_FOR, TRIG, setTrigger, builderAdd, builderSave, builderTest,
} from "@/lib/store";
import { MODES, ROOMS } from "@/lib/data";
import { isLive, deleteScene, editAutomation } from "@/lib/live";

type Opt = [string, string];
const pairs = (a: { id: string; n: string }[]): Opt[] => a.map((x) => [x.id, x.n]);

const emptyB = (kind: "automation" | "scene" | "routine") => ({ kind, name: "", trig: { k: "arrive", p: "anyone" as string | null }, conds: { dark: false, home: false, days: "any", mode: "any" }, acts: [] });
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

/** In a live home, only triggers Alice can build from real devices are offered. */
const usable = (t: { k: string }) => !isLive() || (t.k === "motion" ? false : t.k === "power" ? S.devices.some((d) => d.t === "plug" && d.limit) : t.k === "door" ? S.devices.some((d) => d.t === "contact" || d.t === "cover") : true);

function TrigParam() {
  const b = S.b, k = TRIG.find((x) => x.k === b.trig.k)!, p = (b.trig.p ?? "") as string;
  const setP = (v: string) => { b.trig.p = v; bump(); };
  if (k.p === "person") return <Wrap l="Who"><Select label="Who" value={p} onChange={setP} options={[["anyone", "Anyone"], ...pairs(S.people.filter((x) => x.role !== "guest"))]} /></Wrap>;
  if (k.p === "time") return <Wrap l="Time"><TimeField label="Time" value={p} onChange={setP} /></Wrap>;
  if (k.p === "contact") return <Wrap l="Which"><Select label="Which" value={p} onChange={setP} options={pairs(S.devices.filter((d) => d.t === "contact" || d.t === "cover"))} /></Wrap>;
  if (k.p === "room") return <Wrap l="Where"><Select label="Where" value={p} onChange={setP} options={pairs(ROOMS)} /></Wrap>;
  if (k.p === "plug") return <Wrap l="Which"><Select label="Which" value={p} onChange={setP} options={pairs(S.devices.filter((d) => d.t === "plug" && d.limit))} /></Wrap>;
  return null;
}

function ActRow({ i }: { i: number }) {
  const a = S.b.acts[i], v = VERBS[a.v];
  return (
    <ActionRow icon={v.ic} verb={v.n} onRemove={() => { S.b.acts.splice(i, 1); bump(); }}>
      {a.v === "wait" ? null : <Select label="Choose target" value={a.t} onChange={(t) => { a.t = t; bump(); }} options={pairs(v.pick())} />}
      {v.val ? (v.val.max <= 100
        ? <Stepper label="Value" value={a.n ?? v.val.def} min={v.val.min} max={v.val.max} step={v.val.u === "%" ? 5 : 1} unit={v.val.u} onChange={(n) => { a.n = n; bump(); }} />
        : <><Input className="inp--sm" type="number" min={v.val.min} max={v.val.max} value={a.n} aria-label="Value"
            onChange={(e) => { a.n = Math.min(v.val!.max, Math.max(v.val!.min, +e.target.value || v.val!.def)); bump(); }} />
          <span className="small">{v.val.u}</span></>) : null}
    </ActionRow>
  );
}

function Sum() {
  const { w, c, a } = sumParts();
  if (S.b.kind && S.b.kind !== "automation") return <>{a.length ? <mark className="mt">{S.b.kind === "scene" ? "All at once: " : "In order: "}{joinL(a)}</mark> : <span className="muted">add an action to finish the sentence</span>}.</>;
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
  const b = S.b, c = b.conds, { w, c: cc, a } = sumParts(), st = S.bstep, kind = b.kind ?? "automation", auto = kind === "automation";
  const whenS = (
    <Acc k="when" P={P} st={st}><Hd k="when" cls="w" label="When" text={"When " + w} P={P} st={st} />
      <div className="opts">{TRIG.filter(usable).map((x) => <OptionButton key={x.k} aria-pressed={x.k === b.trig.k} onClick={() => setTrigger(x.k)}><Icon n={x.ic} />{x.n}</OptionButton>)}</div>
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
        <label className="field"><span className="small">Days</span><Select label="Days" value={c.days} onChange={(v) => { c.days = v; bump(); }} options={[["any", "Any day"], ["weekdays", "Weekdays"], ["weekends", "Weekends"]]} /></label>
        <label className="field"><span className="small">Mode</span><Select label="Mode" value={c.mode} onChange={(v) => { c.mode = v; bump(); }} options={[["any", "Any mode"], ...MODES.map((m): Opt => [m.k, m.k])]} /></label>
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
        {VERBS_FOR[kind]!.map((k) => <OptionButton key={k} onClick={() => builderAdd(k)}><Icon n="plus" c="sm" />{VERBS[k]!.n}</OptionButton>)}
        <OptionButton disabled aria-disabled="true"><Icon n="unlock" />Unlock a door</OptionButton>
      </div>
      <Safe items={[{ icon: "shieldcheck", text: `Unlocking is never allowed in ${auto ? "an automation" : kind === "scene" ? "a scene" : "a routine"}. Alice can lock a door for you, but only a person with a passkey can open one.` }]} />
    </Acc>
  );
  const sumS = (
    <section className="tile t-sage" id="t-sum">
      {P ? null : <TileHeader title="In plain English" eyebrow={<><Icon n="sparkle" c="sm" /> Live preview</>} />}
      <p className="sentence"><Sum /></p>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span className="small">Name</span>
        <Input className="inp--fill" value={b.name} placeholder={`Name this ${kind}`} onChange={(e) => { b.name = e.target.value; bump(); }} /></label>
      <div className="btns"><Button variant="primary" onClick={builderSave}><Icon n="check" c="sm" />{b.editId ? "Save changes" : "Save to Home Assistant"}</Button>{auto ? <Button onClick={builderTest}>Dry run</Button> : null}{b.editId ? <Button onClick={() => { S.b = emptyB(kind); bump(); }}>Cancel editing</Button> : null}</div>
      <Safe items={[auto ? "Runs inside Home Assistant, not in Alice." : "A copy is kept in Home Assistant, so it also runs from there.", "Appears in the household log with your name."]} />
    </section>
  );
  const list = (
    <div>{S.autos.length === 0 ? <Empty>No automations yet. Build one and save it.</Empty> : null}{S.autos.map((x) => (
      <div key={x.id} className="auto">
        <div><b>{x.n}</b></div>
        <Switch checked={x.on} label={x.n} onChange={() => A.autotog(x.id)} />
        <p>{x.s}</p>
        <small className="mono" style={{ gridColumn: "1/3" }}>{x.last.startsWith("Last run") ? x.last : `Last run: ${x.last}`}{x.sync ? ` · ${x.sync}` : ""}{isLive() ? <> · <button className="link small" onClick={() => void editAutomation(x.id)}>Edit</button> · <button className="link small" onClick={() => A.autodel(x.id)}>Remove</button></> : null}</small>
      </div>
    ))}</div>
  );
  const sceneList = (
    <div>{SCENES.length === 0 ? <Empty>No scenes or routines yet. Pick Scene or Routine above and save one.</Empty> : null}{SCENES.map((x) => (
      <div key={x.id} className="auto">
        <div><b>{x.n}</b></div>
        <Pill>{x.kind === "routine" ? "Routine" : "Scene"}</Pill>
        {x.d ? <p>{x.d}</p> : <p className="small">No description</p>}
        <small className="mono" style={{ gridColumn: "1/3" }}><button className="link small" onClick={() => A.scene(x.id)}>Run now</button> · <button className="link small" onClick={() => void deleteScene(x)}>Remove</button></small>
      </div>
    ))}</div>
  );
  const sceneS = <section className="tile"><TileHeader title="Your scenes and routines" right={<Pill>{SCENES.length}</Pill>} />{sceneList}</section>;
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

  const kindS = (
    <Segmented value={kind} label="What to build" items={[["automation", "Automation"], ["scene", "Scene"], ["routine", "Routine"]]} onChange={(k) => { S.b = emptyB(k as "automation" | "scene" | "routine"); bump(); }} />
  );
  return (
    <>
      <PageHeader title="Automate">Build an automation (something starts it), a scene (a set of changes at once) or a routine (steps in order). Alice writes it into Home Assistant, so it keeps running even if Alice is offline.</PageHeader>
      {P ? (
        <div className="bgrid" style={{ display: "flex", flexDirection: "column" }}>{kindS}{sumS}{auto ? whenS : null}{auto ? ifS : null}{thenS}{autoS}{sceneS}</div>
      ) : (
        <div className="bgrid">
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{kindS}{auto ? whenS : null}{auto ? ifS : null}{thenS}</div>
          <div className="sticky">{sumS}{autoS}{sceneS}</div>
        </div>
      )}
    </>
  );
}
