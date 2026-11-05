"use client";
import { Icon, Button, IconButton, StepButton, Pill, Chip, Switch, Bar, Avatar, Empty, Safe, Html, Tile, TileHeader, resetTileOrder, Sparkline } from "@/ui";
import { LockButton, DevSlider } from "./device-controls";
import { useRef, type ReactNode } from "react";
import {
  A, S, useS, usePhone, useMounted, tod, status, me, vis, dev, isOn, icn, rname, dateStr, clock, totalW, watts,
  SCENES, suggestion, alerts, backupState, dstate, openSheet, buzz, go, bump, type StatusChip,
} from "@/lib/store";
import { MODES, PRIMARY, type Dev } from "@/lib/data";

const GREET = { morning: "Good morning", day: "Good afternoon", evening: "Good evening", night: "Quiet night" };

function Chips({ chips }: { chips: StatusChip[] }) {
  return <>{chips.map((c, i) => <Chip key={i} icon={c.ic} warn={c.warn} onClick={c.to ? () => A.flash(c.to!) : undefined}>{c.t}</Chip>)}</>;
}

export function DevRow({ d }: { d: Dev }) {
  const on = isOn(d);
  const sub: ReactNode = (
    <>
      {rname(d.r)}
      {d.t === "plug" && d.on && <> · <span className="num">{d.w!.toLocaleString()} W</span></>}
      {d.t === "dim" && d.on && <> · <span className="num">{d.v}%</span></>}
      {d.t === "climate" && (d.on ? ` · ${d.cur!.toFixed(1)}° now, aiming for ${d.tgt}°` : " · off")}
      {d.t === "fan" && d.on && ` · speed ${d.sp}`}
      {d.t === "lock" && (d.locked ? " · locked" : " · unlocked")}
    </>
  );
  const ctl = d.t === "lock" ? <LockButton d={d} /> : d.t === "contact" || d.t === "camera" ? null : <Switch checked={!!d.on} label={d.n} onChange={() => A.tog(d.id)} />;
  return (
    <div className={`row ${on ? "is-on" : ""}`}>
      <span className="dico"><Icon n={icn(d)} /></span>
      <div><b>{d.n}</b><small>{sub}</small></div>
      {ctl}
      {d.t === "dim" && d.on && <div className="sl"><DevSlider d={d} /></div>}
    </div>
  );
}

/* ---------------- desktop tiles ---------------- */
function THero() {
  const t = tod(), st = status(), who = me().n, sc = SCENES.find((s) => s.id === PRIMARY[t])!;
  return (
    <Tile id="hero" cols={8} rows={3} colsTablet={6} className="hero">
      <div className="th"><span className="eyebrow">{dateStr()} · {clock()}</span></div>
      <h1 className="hl"><span className="hl-a">{GREET[t]}, {who}.</span><span className="hl-b">{st.line}</span></h1>
      <div className="chips"><Chips chips={st.chips} /></div>
      <div className="hero-actions">
        <Button variant="primary" onClick={() => A.scene(sc.id)}><Icon n={sc.ic} />{sc.n}</Button>
        <Button onClick={() => A.flash("scenes")}>All scenes</Button>
        <small style={{ color: "var(--hero-ink)", opacity: 0.75 }}>{sc.d}</small>
      </div>
    </Tile>
  );
}
function TMode() {
  const sg = suggestion(), tt = tod();
  return (
    <Tile id="mode" cols={4} rows={3} colsTablet={6} className="t-sage">
      <TileHeader title="Household mode" eyebrow={`Now: ${S.mode}`} />
      <div className="modes">{MODES.map((m) => (
        <button key={m.k} className="mode" aria-pressed={S.mode === m.k} onClick={() => A.mode(m.k)}><Icon n={m.ic} /><b>{m.k}</b><small>{m.d}</small></button>
      ))}</div>
      {sg ? (
        <div className="sugg">
          <div className="eyebrow"><Icon n="sparkle" c="sm" /> Alice suggests</div>
          <div><b>Switch to {sg.to}?</b><div className="small">{sg.why}</div></div>
          <div className="btns">
            <Button variant="sage" size="sm" onClick={() => A.mode(sg.to)}>Switch to {sg.to}</Button>
            <Button size="sm" onClick={() => A.snooze(sg.to + tt)}>Not now</Button>
          </div>
        </div>
      ) : <p className="small">Alice only suggests a mode. She never changes it on her own.</p>}
      <div className="next"><Icon n="clock" /><span>{tt === "night" ? <>Next: <b>Good morning</b> at 6:45 am tomorrow</> : <>Next: <b>Goodnight</b> at 10:30 pm tonight</>}</span></div>
    </Tile>
  );
}
function TFav() {
  const f = vis().filter((d) => d.fav);
  return (
    <Tile id="fav" cols={4} rows={4} colsTablet={3} colsMobile={6}>
      <TileHeader title="Favourites" right={<button className="link small" onClick={() => go("rooms")}>Edit</button>} />
      <div className="list">{f.length ? f.map((d) => <DevRow key={d.id} d={d} />) : <Empty>Star a device in Rooms to pin it here.</Empty>}</div>
      <p className="small" style={{ marginTop: "auto" }}>Star a device in Rooms to pin it here.</p>
    </Tile>
  );
}
function TLocks() {
  const l = S.devices.filter((d) => d.t === "lock"), un = l.filter((d) => !d.locked);
  return (
    <Tile id="locks" cols={4} rows={2} colsTablet={3} className="t-deep deep">
      <TileHeader title="Doors" right={<span className={`pill ${un.length ? "warn" : ""}`}><Icon n={un.length ? "alert" : "shieldcheck"} c="sm" />{un.length ? `${un.length} unlocked` : "All locked"}</span>} />
      <div>{l.map((d) => (
        <div key={d.id} className={`lockrow ${d.locked ? "" : "open"}`}>
          <span className="lk"><Icon n={icn(d)} /></span>
          <div><b>{d.n}</b><small>{d.locked ? "Locked" : "Unlocked"} by {d.by || "someone"}, {d.at || ""}</small></div>
          <LockButton d={d} />
        </div>
      ))}</div>
      {un.length ? <Button variant="primary" onClick={A.lockall}><Icon n="lock" />Lock everything</Button> : <small>Unlocking asks for your passkey. Locking never does.</small>}
    </Tile>
  );
}
function TClimate() {
  const a = dev("ac"), others = S.devices.filter((d) => d.t === "climate" && d.id !== "ac" && (S.role !== "guest" || d.g));
  return (
    <Tile id="climate" cols={4} rows={2} colsTablet={3} className="t-clay">
      <TileHeader title="Climate" eyebrow="Living room" right={<Switch checked={!!a.on} label={a.n} onChange={() => A.tog(a.id)} />} />
      <div className="temp">
        <div className="big">{a.cur!.toFixed(1)}°<small>now</small></div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StepButton onClick={() => A.tgt("ac", -1)} aria-label="Lower target"><Icon n="minus" /></StepButton>
          <div style={{ textAlign: "center", minWidth: 48 }}><b className="num" style={{ fontSize: 20 }}>{a.tgt}°</b><div className="small">target</div></div>
          <StepButton onClick={() => A.tgt("ac", 1)} aria-label="Raise target"><Icon n="plus" /></StepButton>
        </div>
      </div>
      {others.map((d) => (
        <div key={d.id} className={`row ${d.on ? "is-on" : ""}`} style={{ padding: "4px 0" }}>
          <span className="dico"><Icon n="thermo" /></span>
          <div><b>{d.n}</b><small>{d.on ? `Aiming for ${d.tgt}°` : "Off"}</small></div>
          <Switch checked={!!d.on} label={d.n} onChange={() => A.tog(d.id)} />
        </div>
      ))}
    </Tile>
  );
}
function TScenes() {
  const rec = PRIMARY[tod()];
  return (
    <Tile id="scenes" cols={8} rows={2} colsTablet={6}>
      <TileHeader title="Scenes and routines" right={<span className="small">Both run inside Home Assistant</span>} />
      <div className="scenes">{SCENES.map((s) => (
        <button key={s.id} className={`scene ${s.id === rec ? "rec" : ""}`} onClick={() => A.scene(s.id)}>
          <Icon n={s.ic} /><b>{s.n}</b><small>{s.d}</small><span className="eyebrow">{s.id === rec ? "Suggested now" : s.tag}</span>
        </button>
      ))}</div>
    </Tile>
  );
}
function TActivity() {
  const nw = S.activity.filter((a) => a.nw).length;
  return (
    <Tile id="activity" cols={4} rows={4} colsTablet={3}>
      <TileHeader title="While you were away" eyebrow={nw ? `${nw} new` : "Nothing new"}
        right={nw ? <Button size="sm" onClick={A.seen}><Icon n="check" c="sm" />Mark seen</Button> : <Pill tone="ok" icon="check">Caught up</Pill>} />
      <div className="feed">{S.activity.slice(0, 6).map((a, i) => (
        <div key={i} className={`ev ${a.nw ? "new" : ""} ${a.tone || ""}`}>
          <span className="ei"><Icon n={a.ic} /></span>
          <div>{a.nw && <span className="dotnew" title="New" />}<Html html={a.t} /></div>
          <time>{a.time}</time>
        </div>
      ))}</div>
    </Tile>
  );
}
function TPeople() {
  const home = S.people.filter((p) => p.home).length;
  return (
    <Tile id="people" cols={4} rows={2} colsTablet={3} colsMobile={6}>
      <TileHeader title="Who is home" right={<span className={`pill ${home ? "info" : ""}`}>{home} home</span>} />
      <div className="list">{S.people.map((p) => (
        <button key={p.id} className="row" style={{ textAlign: "left" }} onClick={() => A.person(p.id)} aria-label={`${p.n} is ${p.home ? "home" : "away"}. Tap to change.`}>
          <Avatar initial={p.n[0]} tone={p.c} away={!p.home} />
          <div><b>{p.n}</b><small>{p.role === "guest" ? `Guest until ${p.until}` : p.role === "admin" ? "Admin" : "Member"}</small></div>
          <span className={`pill ${p.home ? "ok" : ""}`}>{p.home ? "Home" : "Away"}</span>
        </button>
      ))}</div>
    </Tile>
  );
}
function TEnergy() {
  const kw = totalW() / 1000, top = S.devices.map((d) => ({ n: d.n, w: watts(d) })).sort((a, b) => b.w - a.w).slice(0, 3), mx = top[0].w || 1;
  return (
    <Tile id="energy" cols={S.role === "admin" ? 5 : 8} rows={2} colsTablet={6} colsMobile={6}>
      <TileHeader title="Energy" eyebrow="Last 24 hours" right={<Pill>Today 11.4 kWh</Pill>} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 18, alignItems: "end" }}>
        <div><div className="big num">{kw.toFixed(2)}<small>kW now</small></div></div>
        <div><Sparkline values={[...S.energy.slice(1), kw]} /></div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>{top.map((x) => (
        <div key={x.n} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) 62px", gap: 10, alignItems: "center", fontSize: 13 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.n}</span>
          <Bar percent={Math.round((x.w / mx) * 100)} warn={x.w / mx > 0.9 && x.n === "Water heater"} />
          <span className="num" style={{ textAlign: "right", color: "var(--ink2)" }}>{x.w.toLocaleString()} W</span>
        </div>
      ))}</div>
      <p className="small">Evenings run 18% above your last eight Thursdays. Plain statistics, no guessing.</p>
    </Tile>
  );
}
function TAlerts() {
  const al = alerts(), quiet = S.quiet && tod() === "night";
  return (
    <Tile id="alerts" cols={3} rows={2} colsTablet={3} colsMobile={6} className={al.length ? "t-glow" : ""}>
      <TileHeader title="Alerts" right={quiet ? <Pill tone="info" icon="moon">Quiet hours</Pill> : null} />
      {al.length ? al.map((a) => (
        <div key={a.id} style={{ display: "contents" }}>
          <div className="row" style={{ padding: "2px 0" }}><span className="dico"><Icon n={a.ic} /></span><div><b style={{ lineHeight: 1.25 }}>{a.t}</b><small>{a.d}</small></div></div>
          <Button size="sm" onClick={() => A.ack(a.id)}><Icon n="check" c="sm" />Got it</Button>
        </div>
      )) : <Empty>Nothing needs you right now.</Empty>}
      <div className="list" style={{ marginTop: "auto" }}>
        <div className="row" style={{ padding: "6px 0" }}><div style={{ gridColumn: "1/3" }}><b>Push on this phone</b></div><Switch checked={S.push} label="Push notifications" onChange={A.push} /></div>
        <div className="row" style={{ padding: "6px 0" }}><div style={{ gridColumn: "1/3" }}><b>Quiet hours</b><small>10:30 pm to 6:30 am{quiet ? ". Only critical alerts get through." : ""}</small></div><Switch checked={S.quiet} label="Quiet hours" onChange={A.quiet} /></div>
      </div>
    </Tile>
  );
}
function TBackup() {
  const b = backupState();
  return (
    <Tile id="backup" cols={4} rows={2} colsTablet={3} className="t-sage">
      <TileHeader title="Backups" eyebrow="Admin only" right={<span className={`pill ${b.ok ? "ok" : "warn"}`}><Icon n={b.ok ? "shieldcheck" : "alert"} c="sm" />{b.ok ? "Verified" : "Not verified"}</span>} />
      <p>{b.ok ? "The last backup was restored into a scratch space and checked. It counts as safe." : "The newest backup has not passed a restore test yet, so it does not count as safe."}</p>
      <div className="small">Next backup tonight at 2:30 am, to the NAS.</div>
      <Button size="sm" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={() => go("admin", "backups")}>Open backups <Icon n="chev" c="sm" /></Button>
    </Tile>
  );
}

/* guest */
function TGuestHero() {
  const t = tod(), p = me();
  const greet = { morning: "Good morning", day: "Welcome", evening: "Good evening", night: "Sleep well" }[t];
  return (
    <Tile id="hero" cols={8} rows={3} colsTablet={6} className="hero">
      <div className="th"><span className="eyebrow">Guest · {dateStr()}</span></div>
      <h1 className="hl"><span className="hl-a">{greet}, {p.n}.</span><span className="hl-b">You can control {vis().length} things here until {p.until}.</span></h1>
      <div className="chips"><span className="chip"><Icon n="shieldcheck" />Signed in with a passkey</span><span className="chip"><Icon n="clock" />Access ends in 2 days</span></div>
      <div className="hero-actions"><Button variant="primary" onClick={() => A.cmd()}><Icon n="search" />Ask Alice</Button><small style={{ color: "var(--hero-ink)", opacity: 0.75 }}>Try “turn on the guest lamp”</small></div>
    </Tile>
  );
}
function TGuestDevices() {
  return (
    <Tile id="fav" cols={8} rows={4} colsTablet={6} colsMobile={6}>
      <TileHeader title="Your devices" right={<span className="small">Granted by Gokul</span>} />
      <div className="list">{vis().filter((d) => d.t !== "camera").map((d) => <DevRow key={d.id} d={d} />)}</div>
    </Tile>
  );
}
function TNotes() {
  return (
    <Tile id="notes" cols={4} rows={3} colsTablet={3} className="t-glow">
      <TileHeader title="Notes from the host" eyebrow={<><Icon n="note" c="sm" /> Left by Gokul</>} />
      <div className="kv"><div><span>Wi-Fi</span><span className="mono">Home-5G</span></div><div><span>Password</span><span className="mono">maple-kite-4829</span></div><div><span>Bins go out</span><span>Thursday night</span></div><div><span>Quiet after</span><span>10:30 pm</span></div></div>
      <Button size="sm" style={{ alignSelf: "flex-start" }} onClick={() => A.copy("maple-kite-4829")}><Icon n="copy" c="sm" />Copy password</Button>
    </Tile>
  );
}
function TAccess() {
  return (
    <Tile id="access" cols={4} rows={3} colsTablet={3} colsMobile={6}>
      <TileHeader title="What you can see" />
      <Safe items={["Lights, AC and fan in the living room and guest room", "The front door, to lock and unlock with your passkey", { text: "Cameras, energy use and other rooms stay private", muted: true }]} />
      <p className="small" style={{ marginTop: "auto" }}>Ends Sun 9 Nov at 11:00. Gokul can extend it any time.</p>
    </Tile>
  );
}

/* ---------------- phone ---------------- */
export function DTile({ d, hideRoom }: { d: Dev; hideRoom?: boolean }) {
  const on = isOn(d), warn = d.t === "lock" && !d.locked;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const stop = () => { if (timer.current) clearTimeout(timer.current); };
  return (
    <div className="dtw">
      <button className={`dt ${on ? "is-on" : ""} ${warn ? "warn" : ""}`}
        aria-label={`${d.n}, ${dstate(d)}. Tap to ${d.t === "lock" ? (d.locked ? "unlock" : "lock") : "toggle"}. Hold for more.`}
        onPointerDown={() => { fired.current = false; stop(); timer.current = setTimeout(() => { fired.current = true; buzz(18); openSheet(d.id); }, 430); }}
        onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => { if (fired.current) { fired.current = false; e.preventDefault(); return; } A.dtap(d.id); }}>
        {d.t === "dim" && d.on ? <i className="dfill" style={{ height: `${d.v}%` }} /> : null}
        <span className="dico"><Icon n={icn(d)} /></span>
        <span className="dn"><b>{d.n}</b><small><span>{dstate(d)}</span>{hideRoom ? "" : " · " + rname(d.r)}</small></span>
      </button>
      <button className="dmore" onClick={() => openSheet(d.id)} aria-label={`More controls for ${d.n}`}><Icon n="chev" /></button>
    </div>
  );
}
const plain = (h: string) => h.replace(/<[^>]+>/g, "");
function HomePhone() {
  const t = tod(), st = status(), who = me().n, al = st.al;
  const sc = SCENES.find((s) => s.id === PRIMARY[t])!, l = S.devices.filter((d) => d.t === "lock"), un = l.filter((d) => !d.locked);
  const sg = suggestion(), favs = vis().filter((d) => d.fav), ac = dev("ac"), kw = totalW() / 1000, nw = S.activity.filter((a) => a.nw).length, bk = backupState();
  const sd = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const att = al.length || un.length;
  return (
    <div className="pg">
      <div className="mini" id="mini"><span className={`dot ${att ? "w" : ""}`} /><span className="ms">{GREET[t]}. {st.line}</span><Button onClick={() => A.scene(sc.id)}><Icon n={sc.ic} c="sm" />{sc.n}</Button></div>
      <Tile id="hero" className="pt s2 phero" bare>
        <span className="eyebrow">{sd} · {clock()}</span>
        <h1 className="hl"><span className="hl-a">{GREET[t]}, {who}.</span><span className="hl-b">{st.line}</span></h1>
        <div className="hrow"><Button onClick={() => A.scene(sc.id)}><Icon n={sc.ic} />{sc.n}</Button><div className="chips"><Chips chips={st.chips} /></div></div>
      </Tile>
      {al.length ? (
        <Tile id="alerts" className="pt s2 t-glow abn" bare>
          <span className="dico"><Icon n={al[0].ic} /></span>
          <div className="grow"><b>{al[0].t}</b>{al.length > 1 && <small>+{al.length - 1} more</small>}</div>
          <Button size="sm" onClick={() => A.ack(al[0].id)}><Icon n="check" c="sm" />Got it</Button>
        </Tile>
      ) : null}
      <Tile id="mode" className="pt s2 t-sage mtile" bare>
        <div className="pmodes" role="group" aria-label="Household mode">{MODES.map((m) => (
          <button key={m.k} className="mode" aria-pressed={S.mode === m.k} onClick={() => A.mode(m.k)}><Icon n={m.ic} /><b>{m.k}</b></button>
        ))}</div>
        {sg ? (
          <div className="srow"><Icon n="sparkle" c="sm" /><span><b>Switch to {sg.to}?</b> <span className="small">{sg.why}</span></span>
            <Button variant="sage" size="sm" onClick={() => A.mode(sg.to)}>Switch</Button>
            <IconButton style={{ width: 32, height: 32 }} onClick={() => A.snooze(sg.to + t)} aria-label="Not now"><Icon n="x" c="sm" /></IconButton></div>
        ) : null}
      </Tile>
      <div className="sh2"><h2>Favourites</h2><small>Tap · hold for more</small></div>
      {favs.length ? (
        <div className="pg3">{favs.map((d) => <DTile key={d.id} d={d} />)}
          {favs.length % 3 ? <div className="dtw"><button className="dt add" onClick={() => go("rooms")}><Icon n="plus" />Add favourite</button></div> : null}</div>
      ) : <Empty style={{ gridColumn: "span 2" }}>Star a device in Rooms to pin it here.</Empty>}
      <Tile id="locks" className="pt s2 t-deep deep dstrip" bare>
        <div className="lkpair">{l.map((d) => (
          <button key={d.id} className={`lkb ${d.locked ? "" : "open"}`} onClick={() => (d.locked ? A.unlock(d.id) : A.lock(d.id))}
            aria-label={`${d.n} is ${d.locked ? "locked. Tap to unlock" : "unlocked. Tap to lock"}`}>
            <span className="lk"><Icon n={icn(d)} /></span><span><b>{d.n}</b><small>{d.locked ? "Locked" : "Open · tap to lock"}</small></span>
          </button>
        ))}</div>
      </Tile>
      <Tile id="scenes" className="pt s2" bare style={{ padding: "8px 10px" }}>
        <div className="hs">{SCENES.map((s) => (
          <button key={s.id} className={`scene ${s.id === PRIMARY[t] ? "rec" : ""}`} title={s.d} onClick={() => A.scene(s.id)}>
            <Icon n={s.ic} /><b>{s.n}</b>{s.id === PRIMARY[t] && <span className="eyebrow">Suggested</span>}
          </button>
        ))}</div>
      </Tile>
      <Tile id="climate" className="pt t-clay" bare>
        <div className="th" style={{ minHeight: 24 }}><span className="eyebrow">Living AC</span><Switch checked={!!ac.on} label={ac.n} onChange={() => A.tog(ac.id)} /></div>
        <div className="mini-big">{ac.cur!.toFixed(1)}°</div>
        <div className="temp"><StepButton onClick={() => A.tgt("ac", -1)} aria-label="Lower target"><Icon n="minus" /></StepButton><b className="num" style={{ fontSize: 17 }}>{ac.tgt}° <small style={{ fontWeight: 500 }}>target</small></b><StepButton onClick={() => A.tgt("ac", 1)} aria-label="Raise target"><Icon n="plus" /></StepButton></div>
      </Tile>
      <Tile id="energy" className="pt" bare>
        <div className="th" style={{ minHeight: 24 }}><span className="eyebrow">Energy now</span></div>
        <div className="mini-big num">{kw.toFixed(2)}<small>kW</small></div>
        <Sparkline values={[...S.energy.slice(1), kw]} width={160} height={40} /><small>Today 11.4 kWh</small>
      </Tile>
      <Tile id="activity" className="pt s2" bare>
        <button className="accrow" onClick={() => { S.exp.act = !S.exp.act; bump(); }} aria-expanded={!!S.exp.act}>
          <span className="ei"><Icon n={nw ? "clock" : "check"} /></span>
          <span className="grow"><b>{nw ? nw + " new since you were away" : "Caught up"}</b><small>{plain(S.activity[0].t)}</small></span>
          <Icon n="chev" c="sm accv" />
        </button>
        {S.exp.act ? (<>
          <div>{S.activity.slice(0, 6).map((a, i) => (
            <div key={i} className={`pev ${a.nw ? "new" : ""} ${a.tone || ""}`}><span className="ei"><Icon n={a.ic} /></span><Html as="div" html={a.t} /><time>{a.time}</time></div>
          ))}</div>
          {nw ? <Button size="sm" style={{ alignSelf: "flex-start" }} onClick={A.seen}><Icon n="check" c="sm" />Mark seen</Button> : null}
        </>) : null}
      </Tile>
      <Tile id="people" className="pt s2" bare>
        <div className="avrow">{S.people.map((p) => (
          <button key={p.id} className="avp" onClick={() => A.person(p.id)} aria-label={`${p.n} is ${p.home ? "home" : "away"}. Tap to change.`}>
            <Avatar initial={p.n[0]} tone={p.c} away={!p.home} />{p.n}<small>{p.home ? "Home" : "Away"}</small>
          </button>
        ))}</div>
      </Tile>
      {S.role === "admin" ? (
        <Tile id="backup" className="pt s2 t-sage" bare style={{ padding: "6px 12px" }}>
          <button className="accrow" onClick={() => go("admin", "backups")}>
            <span className="ei" style={{ background: "var(--over)" }}><Icon n={bk.ok ? "shieldcheck" : "alert"} /></span>
            <span className="grow"><b>Backups {bk.ok ? "verified" : "not verified"}</b><small>Next one at 2:30 am</small></span><Icon n="chev" c="sm accv" />
          </button>
        </Tile>
      ) : null}
    </div>
  );
}

/* ---------------- view ---------------- */
export function HomeView() {
  useS();
  const phone = usePhone(), mounted = useMounted();
  if (!mounted) return null;
  resetTileOrder();
  if (phone && S.role !== "guest") return <HomePhone />;
  if (S.role === "guest") return <div className="grid"><TGuestHero /><TNotes /><TGuestDevices /><TAccess /></div>;
  return (
    <div className="grid">
      <THero /><TMode /><TFav /><TActivity /><TLocks /><TClimate /><TScenes /><TPeople /><TEnergy /><TAlerts />
      {S.role === "admin" ? <TBackup /> : null}
    </div>
  );
}
