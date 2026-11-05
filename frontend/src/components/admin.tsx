"use client";
import { Icon, Button, IconButton, Pill, Segmented, OptionButton, Bar, Avatar, Safe, Steps, Table, Tabs, PageHeader, Tile, TileHeader, AccordionContext, resetTileOrder, type AccordionApi, type Tone } from "@/ui";
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { A, S, useS, usePhone, useMounted, backupState, bump, fmtCd, toast } from "@/lib/store";

type V = CSSProperties & Record<`--${string}`, string | number>;
const O = (v: string, t: string) => <option key={v} value={v}>{t}</option>;

function People() {
  return <>
    <Tile id="ppl" defaultOpen cols={7} rows={4} colsTablet={6}>
      <TileHeader title="Household" right={<Pill>{S.people.length} people</Pill>} />
      <div className="list">{S.people.map((p) => (
        <div key={p.id} className="row">
          <Avatar initial={p.n[0]} tone={p.c} />
          <div><b>{p.n}{p.id === "gokul" ? <> <span className="small">(you)</span></> : null}</b>
            <small>{p.role === "guest" ? `Guest · ends ${p.until} · ${S.devices.filter((d) => d.g).length} devices` : "Passkey sign-in"}</small></div>
          {p.id === "gokul" ? <Pill tone="info">Admin</Pill> : (
            <select className="sel" aria-label={`Role for ${p.n}`} value={p.role}
              onChange={(e) => { p.role = e.target.value as typeof p.role; bump(); toast(`${p.n} is now ${p.role === "admin" ? "an admin" : "a " + p.role}`); }}>
              {["admin", "member", "guest"].map((r) => O(r, r[0].toUpperCase() + r.slice(1)))}
            </select>
          )}
        </div>
      ))}</div>
      <div className="kv" style={{ marginTop: "auto" }}>
        <div><span>Admin</span><span style={{ fontWeight: 500 }}>Everything, including this page</span></div>
        <div><span>Member</span><span style={{ fontWeight: 500 }}>All devices, automations, energy</span></div>
        <div><span>Guest</span><span style={{ fontWeight: 500 }}>Only granted devices, never energy</span></div>
      </div>
    </Tile>
    <Tile id="inv" cols={5} rows={3} colsTablet={6} className="t-glow">
      <TileHeader title="Invite someone" />
      <div className="field">
        <Segmented value={S.inv.role} label="Role" items={[["Member", "Member"], ["Guest", "Guest"]]} onChange={(r) => { S.inv.role = r; S.inv.code = null; bump(); }} />
        <label className="field"><span className="small">Expires in</span>
          <select className="sel" value={S.inv.exp} onChange={(e) => { S.inv.exp = e.target.value; S.inv.code = null; bump(); }}>{["1 hour", "24 hours", "7 days"].map((x) => O(x, x))}</select></label>
      </div>
      {S.inv.code ? <>
        <div className="code"><span>{S.inv.code}</span><IconButton onClick={() => A.copy(S.inv.code!)} aria-label="Copy code"><Icon n="copy" /></IconButton></div>
        <p className="small">Works once. They choose a passkey when they use it.</p></>
        : <Button variant="primary" style={{ alignSelf: "flex-start" }} onClick={A.invmake}><Icon n="plus" c="sm" />Create one-time code</Button>}
      {S.invites.length ? <div className="list">{S.invites.map((x, i) => (
        <div key={x.code} className="row" style={{ padding: "6px 0" }}>
          <span className="dico"><Icon n="key" /></span>
          <div><b className="mono" style={{ fontSize: 13 }}>{x.code}</b><small>{x.role} · {x.exp}</small></div>
          <Button size="sm" onClick={() => A.invrev(i)}>Revoke</Button>
        </div>
      ))}</div> : null}
    </Tile>
    <Tile id="pk" cols={5} rows={2} colsTablet={6}>
      <TileHeader title="Sign-in" right={<Pill tone="ok" icon="shieldcheck">Passkeys only</Pill>} />
      <p className="muted">There are no passwords to leak or reset. Each person signs in with a passkey on their own phone or laptop.</p>
      <Button size="sm" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={A.addpk}><Icon n="finger" c="sm" />Add a passkey on this device</Button>
    </Tile>
  </>;
}

function Backups() {
  const run = S.bk.run, st = backupState();
  const steps = ["Copying the backup to a scratch space", "Restoring it there", "Checking devices, people and automations"];
  return <>
    <Tile id="bstat" defaultOpen cols={7} rows={3} colsTablet={6} className="t-sage">
      <TileHeader title="Backup safety" right={<Pill tone={st.ok ? "ok" : "warn"} icon={st.ok ? "shieldcheck" : "alert"}>{st.ok ? "Verified" : "Not verified yet"}</Pill>} />
      <div className="hl" style={{ gap: 6 }}>
        <div className="big" style={{ fontSize: "clamp(1.8rem,3vw,2.6rem)" }}>{st.ok ? "Your last backup works." : "The newest backup is untested."}</div>
        <p className="muted" style={{ maxWidth: "52ch" }}>{st.ok ? `A backup only counts as verified after Alice restores it into a scratch space and checks it. That happened ${S.lastVerified}.` : "It was created just now. Until it passes a restore test it does not count as a safe copy."}</p>
      </div>
      {run !== null ? <Steps steps={steps} current={run} /> : null}
      <div className="btns" style={{ marginTop: "auto" }}>
        <Button variant="primary" onClick={A.bknow} disabled={run !== null}><Icon n="download" c="sm" />Back up now</Button>
        <Button onClick={A.bktest} disabled={run !== null}><Icon n="shieldcheck" c="sm" />Run restore test</Button>
      </div>
    </Tile>
    <Tile id="bdest" cols={5} rows={3} colsTablet={6}>
      <TileHeader title="Where and when" />
      <div className="kv">
        <div><span>Destination</span><span><Segmented value={S.bk.dest} label="Destination" items={[["Local disk", "Local disk"], ["NAS", "NAS"]]} onChange={A.bkdest} /></span></div>
        <div><span>Location</span><span className="mono" style={{ fontSize: 13 }}>{S.bk.dest === "NAS" ? "nas.local/alice" : "/var/lib/alice/backups"}</span></div>
        <div><span>Encryption</span><span>On, household key</span></div>
        <div><span>Schedule</span><span>Nightly, 2:30 am</span></div>
        <div><span>Keeps</span><span>Last 14 backups</span></div>
      </div>
    </Tile>
    <Tile id="bhist" cols={12} rows={3} colsTablet={6}>
      <TileHeader title="Recent backups" />
      <Table head={["When", "Size", "Where", "Status"]} rows={S.backups.slice(0, 6).map((x) => [
        x.when, <span key="s" className="num">{x.size}</span>, x.where,
        <span key="v"><Pill tone={x.verified ? "ok" : "warn"} icon={x.verified ? "check" : "clock"}>{x.verified ? "Verified" : "Not tested yet"}</Pill> <span className="small">{x.verified ? x.note : "Counts after a restore test"}</span></span>,
      ])} />
    </Tile>
  </>;
}

function Health() {
  const items: [string, string, string, string, Tone][] = [
    ["Home Assistant", "Connected", "38 ms round trip", "home", "ok"], ["Alice server", "Running", "Up 12 days", "server", "ok"],
    ["Database", "Healthy", "212 MB, no errors", "disk", "ok"], ["Live updates", "3 phones connected", "2 s average delay", "pulse", "ok"],
    ["Push alerts", "Delivering", "Last sent 5:55 pm", "bell", "ok"], ["NAS", "Reachable", "4 ms", "disk", "ok"],
    ["Voice (HA Cloud)", "Linked", `${S.devices.filter((d) => d.voice).length} items shared`, "mic", "ok"],
    ["Updater", S.upd.state === "done" ? "Up to date" : "Update ready", S.upd.state === "done" ? "1.9.0 installed" : "1.9.0, signature checked", "rocket", S.upd.state === "done" ? "ok" : "info"],
  ];
  return <>
    <Tile id="hhead" cols={12} rows={1} colsTablet={6}>
      <div className="th">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Pill tone="ok" icon="check" style={{ padding: "6px 12px" }}>All systems working</Pill><span className="small">{S.hc === "run" ? "Checking…" : "Checked just now"}</span></div>
        <Button size="sm" onClick={A.recheck}><Icon n="refresh" c={`sm ${S.hc === "run" ? "spin" : ""}`} />Check again</Button>
      </div>
    </Tile>
    {items.map((x) => (
      <Tile key={x[0]} id={"h" + x[0].replace(/\W/g, "")} cols={3} rows={2} colsTablet={3} colsMobile={3}>
        <div className="th"><span className="dico"><Icon n={x[3]} /></span><Pill tone={x[4]} icon={x[4] === "ok" ? "check" : "rocket"}>{x[1]}</Pill></div>
        <div className="hsvc"><b style={{ font: "650 17px var(--f-display)" }}>{x[0]}</b><span className="m">{x[2]}</span></div>
      </Tile>
    ))}
    <Tile id="hdisk" cols={12} rows={1} colsTablet={6}>
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 14, alignItems: "center" }}>
        <b>Disk</b><Bar percent={62} /><span className="num small">62% of 128 GB used</span>
      </div>
    </Tile>
  </>;
}

function Updates() {
  const u = S.upd, steps = ["Backing up first", "Downloading the release", "Checking the signature", "Restarting Alice"], done = u.state === "done";
  const ready = S.em.reason.trim().length >= 8 && S.em.word === "DEPLOY";
  return <>
    <Tile id="ucur" defaultOpen cols={5} rows={3} colsTablet={6}>
      <TileHeader title="Installed" right={<Pill tone="ok" icon="shieldcheck">Signed</Pill>} />
      <div className="big">{u.cur}</div>
      <div className="kv"><div><span>Signed by</span><span>Zohorobotics release key</span></div><div><span>Pinned key</span><span className="mono" style={{ fontSize: 12.5 }}>7F3A 91C2 E4B8 0D56</span></div><div><span>Applied by</span><span>Host updater, not the app</span></div></div>
    </Tile>
    <Tile id="unew" cols={7} rows={3} colsTablet={6} className={done ? "" : "t-glow"}>
      {done ? <><TileHeader title="You are up to date" /><p className="muted">Version {u.cur} is installed and running. Nothing else is waiting.</p></> : <>
        <TileHeader title={`Version ${u.avail} is ready`} eyebrow="Released 3 Nov" right={<Pill tone="ok" icon="check">Signature verified</Pill>} />
        <Safe items={["Faster live updates on slow Wi-Fi", "Guest access shows its end time everywhere", "Backup restore tests run 30% quicker"]} />
        {u.state === "installing" ? <Steps steps={steps} current={u.step} />
        : u.state === "scheduled" ? <>
          <Pill tone="info" icon="clock" style={{ alignSelf: "flex-start" }}>Scheduled for 2:30 tonight, after the backup</Pill>
          <Button size="sm" style={{ alignSelf: "flex-start" }} onClick={A.updcancel}>Cancel schedule</Button></>
        : <div className="btns" style={{ marginTop: "auto" }}>
          <Button variant="primary" onClick={A.updnight}><Icon n="moon" c="sm" />Install tonight at 2:30</Button>
          <Button onClick={A.updnow}>Install now</Button></div>}
      </>}
    </Tile>
    <Tile id="uem" cols={12} rows={2} colsTablet={6}>
      <TileHeader title="Emergency deploy" eyebrow="Skips the nightly window" right={<Button size="sm" onClick={A.emtoggle} aria-expanded={S.em.open}>{S.em.open ? "Close" : "Open"}</Button>} />
      {S.em.open ? (
        <div className="danger">
          <p>Use this only to fix a live problem. It is recorded for your household and for the company, with your name.</p>
          <textarea className="inp" rows={2} placeholder="What is broken, and why can it not wait?" aria-label="Reason" value={S.em.reason} onChange={(e) => { S.em.reason = e.target.value; bump(); }} />
          <div className="field">
            <label className="field"><span className="small">Type DEPLOY to confirm</span>
              <input className="inp" style={{ width: 140 }} value={S.em.word} autoComplete="off" onChange={(e) => { S.em.word = e.target.value; bump(); }} /></label>
            <Button variant="danger" disabled={!ready} onClick={A.emgo}><Icon n="rocket" c="sm" />Deploy now</Button>
          </div>
        </div>
      ) : <p className="muted">Closed to stop accidental taps.</p>}
    </Tile>
  </>;
}

function Countdown({ end, dur }: { end: number; dur: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  const left = end - Date.now(), pct = Math.max(0, (left / (dur * 3600e3)) * 100);
  const style: V = { "--p": pct, "--tile": "var(--deep)" };
  return <div className="ring" style={style}><div style={{ background: "var(--deep)" }}>{fmtCd(left)}</div></div>;
}
const SCOPE: Record<string, string> = { health: "system health", devices: "device list", cameras: "cameras", control: "controls" };
function Support() {
  const s = S.sup, a = s.active;
  return <>
    {a ? (
      <Tile id="sact" defaultOpen cols={7} rows={3} colsTablet={6} className="t-deep deep">
        <TileHeader title="Support is connected" eyebrow="Operator ops-114" right={<Pill tone="warn" icon="clock">Time-boxed</Pill>} />
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <Countdown end={a.end} dur={a.dur} />
          <div className="grow"><b>Access ends on its own</b>
            <p className="small">Can see: {Object.entries(s.scope).filter((x) => x[1]).map((x) => SCOPE[x[0]]).join(", ") || "nothing"}. It can never unlock a door.</p></div>
        </div>
        <div className="btns" style={{ marginTop: "auto" }}><Button variant="primary" onClick={A.supend}>End access now</Button><Button onClick={A.supext}>Add 1 hour</Button></div>
      </Tile>
    ) : (
      <Tile id="sgrant" defaultOpen cols={7} rows={3} colsTablet={6}>
        <TileHeader title="No one has access right now" right={<Pill tone="ok" icon="shieldcheck">Closed</Pill>} />
        <p className="muted">Support can only come in when you let them, for a set time. You decide what they can see.</p>
        <div className="field"><span className="small">For</span>
          <Segmented value={s.dur} label="Duration" items={[1, 4, 24].map((h) => [h, `${h} hour${h > 1 ? "s" : ""}`] as [number, string])} onChange={(h) => { s.dur = h; bump(); }} /></div>
        <div className="opts">{([["health", "System health"], ["devices", "Device list"], ["cameras", "Camera views"], ["control", "Controls"]] as const).map(([k, l]) => (
          <OptionButton key={k} aria-pressed={s.scope[k]} onClick={() => { s.scope[k] = !s.scope[k]; bump(); }}><Icon n={s.scope[k] ? "check" : "plus"} c="sm" />{l}</OptionButton>
        ))}</div>
        <Button variant="primary" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={A.supgrant}><Icon n="key" c="sm" />Grant access with passkey</Button>
      </Tile>
    )}
    <Tile id="srule" cols={5} rows={3} colsTablet={6}>
      <TileHeader title="How this stays honest" />
      <Safe items={["Support signs in with a separate identity. It never uses a household login.", "Every session ends on its own. You can end it sooner.", "The household log is plain language. The operator trail is stored apart, so it cannot be edited from your side or theirs."]} />
    </Tile>
    <Tile id="hlg" cols={6} rows={3} colsTablet={6}>
      <TileHeader title="What your household sees" right={<Pill>Everyone</Pill>} />
      <div className="log">{S.hlog.slice(0, 6).map((x, i) => {
        const m = x.t.match(/^(\w{3}) (.*)$/);
        return <div key={i}><time>{m ? <>{m[1]}<br />{m[2]}</> : x.t}</time><span>{x.x}</span></div>;
      })}</div>
    </Tile>
    <Tile id="olg" cols={6} rows={3} colsTablet={6}>
      <TileHeader title="Who did it: operator trail" right={<Pill>Admins only</Pill>} />
      <Table mono head={["Time", "Who", "Action", "Target"]} rows={S.olog.slice(0, 6).map((x) => [x.t, x.op, x.a, x.r])} />
    </Tile>
  </>;
}

const accordion: AccordionApi = {
  get scope() { return S.at; },
  isOpen: (key, fallback) => S.aopen[key] ?? fallback,
  toggle: (key, next) => { S.aopen[key] = next; bump(); },
};

const BODY: Record<string, () => ReactNode> = { people: People, backups: Backups, health: Health, updates: Updates, support: Support };

export function AdminView() {
  useS();
  const phone = usePhone(), mounted = useMounted();
  if (!mounted) return null;
  resetTileOrder();
  const tabs: [string, string, boolean?][] = [["people", "People"], ["backups", "Backups", !backupState().ok], ["health", "Health"], ["updates", "Updates", S.upd.state === "ready"], ["support", "Support access", !!S.sup.active]];
  const Body = BODY[S.at] ?? People;
  return (
    <>
      <PageHeader title="Admin">The household’s plumbing. Everything here asks for care, so sensitive steps ask for your passkey.</PageHeader>
      <Tabs label="Admin sections" value={S.at} onChange={(id) => { S.at = id; bump(); }} tabs={tabs.map(([id, label, badge]) => ({ id, label, badge }))} />
      <AccordionContext.Provider value={phone && S.at !== "health" ? accordion : null}><div className="grid"><Body /></div></AccordionContext.Provider>
    </>
  );
}
