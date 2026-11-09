"use client";
import { Icon, Button, IconButton, Pill, Input, Textarea, Select, Segmented, Switch, Stepper, TimeField, Notice, Tooltip, OptionButton, Avatar, Safe, Steps, Table, Tabs, PageHeader, Tile, TileHeader, AccordionContext, type AccordionApi } from "@/ui";
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";
import { A, S, useS, usePhone, useMounted, bump, fmtCd, toast, passkey } from "@/lib/store";
import { ADM, deleteBackup, downloadBackup, endSupport, extendSupport, grantSupport, linkPerson, moreAudit, removeMember, restoreBackup, rollbackUpdate, setAuditFilter, verifyBackup, backUpNow, createInvite, emergencyDeploy, inviteHours, loadAdminTab, loadHealth, revokeInvite, saveBackupSettings, setAutoUpdate, setRole, testLatest, updateAction, type BackupItem, type Member } from "@/lib/admin";
import { ok, v1 } from "@/lib/api";
import { addPasskey, passkeyMessage } from "@/lib/auth";
import { clockOf } from "@/lib/live";
import { auditSentence } from "@/lib/audit-text";

type V = CSSProperties & Record<`--${string}`, string | number>;

/** "person.test_admin" as "Test admin", for a person Home Assistant has already linked. */
const personName = (id: string) => { const n = id.replace(/^person\./, "").replace(/_/g, " "); return n[0]!.toUpperCase() + n.slice(1); };
const WHERE: Record<string, string> = { local: "This server", nas: "NAS", upload: "Remote", ha: "Home Assistant" };
const size = (n: number | null) => (n == null ? "…" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const ago = (at: number) => clockOf(at);

function People() {
  const guests = S.devices.length;
  return <>
    <Tile id="ppl" defaultOpen cols={7} rows={4} colsTablet={6}>
      <TileHeader title="Household" right={<Pill>{ADM.members.length} {ADM.members.length === 1 ? "person" : "people"}</Pill>} />
      <div className="list">{ADM.members.map((p: Member) => (
        <div key={p.id} className="row">
          <Avatar initial={p.name[0]} tone={p.color} />
          <div><b>{p.name}{p.me ? <> <span className="small">(you)</span></> : null}</b>
            <small>{p.role === "guest" ? `Guest${p.expiresAt ? ` · ends ${clockOf(p.expiresAt)}` : ""}` : "Passkey sign-in"}</small></div>
          {p.me ? <Pill tone="info">{p.role === "admin" ? "Admin" : p.role === "member" ? "Member" : "Guest"}</Pill> : (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Select label={`Role for ${p.name}`} value={p.role} options={[["admin", "Admin"], ["member", "Member"], ["guest", "Guest"]]} onChange={(r) => { void setRole(p, r as Member["role"]); }} />
              <Tooltip label="Remove from the home"><IconButton aria-label={`Remove ${p.name}`} onClick={() => passkey(`Remove ${p.name}?`, "They lose access to the home straight away. Their passkeys stop working here.", () => void removeMember(p))}><Icon n="trash" /></IconButton></Tooltip>
            </span>
          )}
          {p.role !== "guest" && ADM.persons.length + ADM.people.filter((x) => x.userId === p.userId && x.personEntityId).length > 0 ? (
            <div style={{ gridColumn: "2 / -1" }}><label className="field"><span className="small">Phone in Home Assistant</span>
              <Select label={`Home Assistant person for ${p.name}`} value={ADM.people.find((x) => x.userId === p.userId)?.personEntityId ?? ""} onChange={(v) => void linkPerson(p.userId, v || null)}
                options={[["", "Not linked"], ...ADM.persons.map((x): [string, string] => [x.entityId, x.name]), ...ADM.people.filter((x) => x.userId === p.userId && x.personEntityId).map((x): [string, string] => [x.personEntityId!, personName(x.personEntityId!)])]} /></label></div>
          ) : null}
        </div>
      ))}</div>
      <div className="kv kv-roles" style={{ marginTop: "auto" }}>
        <div><span>Admin</span><span style={{ fontWeight: 500 }}>Everything, including this page</span></div>
        <div><span>Member</span><span style={{ fontWeight: 500 }}>All devices, automations, energy</span></div>
        <div><span>Guest</span><span style={{ fontWeight: 500 }}>Only granted devices ({guests} on this home), never energy</span></div>
      </div>
    </Tile>
    <Tile id="inv" cols={5} rows={3} colsTablet={6} className="t-glow">
      <TileHeader title="Invite someone" />
      <div className="field">
        <Segmented value={ADM.inv.role} label="Role" items={[["Member", "Member"], ["Guest", "Guest"]]} onChange={(r) => { ADM.inv.role = r; ADM.newCode = null; bump(); }} />
        <label className="field"><span className="small">Expires in</span>
          <Select label="Expires in" value={ADM.inv.hours === 1 ? "1 hour" : ADM.inv.hours === 168 ? "7 days" : "24 hours"} onChange={(v) => { ADM.inv.hours = inviteHours(v); ADM.newCode = null; bump(); }} options={[["1 hour", "1 hour"], ["24 hours", "24 hours"], ["7 days", "7 days"]]} /></label>
      </div>
      {ADM.newCode ? <>
        <div className="code"><span>{ADM.newCode}</span><IconButton onClick={() => A.copy(ADM.newCode!)} aria-label="Copy code"><Icon n="copy" /></IconButton></div>
        <p className="small">Works once. They choose a passkey when they use it. This code is shown only now.</p></>
        : <Button variant="primary" style={{ alignSelf: "flex-start" }} onClick={() => void createInvite()}><Icon n="plus" c="sm" />Create one-time code</Button>}
      {ADM.invitations.length ? <div className="list">{ADM.invitations.map((x) => (
        <div key={x.id} className="row" style={{ padding: "6px 0" }}>
          <span className="dico"><Icon n="key" /></span>
          <div><b style={{ fontSize: "0.8125rem" }}>Waiting to be used</b><small>{x.role === "guest" ? "Guest" : "Member"} · expires {clockOf(x.expiresAt)}</small></div>
          <Button size="sm" onClick={() => void revokeInvite(x.id)}>Revoke</Button>
        </div>
      ))}</div> : null}
    </Tile>
    <Tile id="pk" cols={5} rows={2} colsTablet={6}>
      <TileHeader title="Sign-in" right={<Pill tone="ok" icon="shieldcheck">Passkeys only</Pill>} />
      <p className="muted">There are no passwords to leak or reset. Each person signs in with a passkey on their own phone or laptop.</p>
      <Button size="sm" style={{ alignSelf: "flex-start", marginTop: "auto" }} onClick={() => { addPasskey().then(() => toast("Passkey added to this device"), (e) => toast(passkeyMessage(e))); }}><Icon n="finger" c="sm" />Add a passkey on this device</Button>
    </Tile>
  </>;
}

function Backups() {
  const set = ADM.bset, app = ADM.backups.filter((b) => b.kind === "app");
  const latest = app.find((b) => b.status === "ok"), ok = latest?.verify.status === "passed", testing = ADM.testing || ADM.backups.some((b) => b.status === "running" || b.verify.status === "running");
  const steps = ["Reading the backup and checking its checksum", "Opening it as a database", "Checking people, homes and tables"];
  const when = latest?.verify.at ? ago(latest.verify.at) : null;
  return <>
    <Tile id="bstat" defaultOpen cols={7} rows={3} colsTablet={6} className="t-sage">
      <TileHeader title="Backup safety" right={<Pill tone={ok ? "ok" : "warn"} icon={ok ? "shieldcheck" : "alert"}>{ok ? "Verified" : latest ? "Not verified yet" : "No backup yet"}</Pill>} />
      <div className="hl" style={{ gap: 6 }}>
        <div className="big" style={{ fontSize: "clamp(1.8rem,3vw,2.6rem)" }}>{ok ? "Your last backup works." : latest ? "The newest backup is untested." : "There is no backup yet."}</div>
        <p className="muted" style={{ maxWidth: "52ch" }}>{ok ? `A backup only counts as verified after Alice opens it and checks it. That happened ${when}.` : latest ? (latest.verify.status === "failed" ? `It failed its test: ${latest.verify.note}` : "Until it passes a restore test it does not count.") : "Make one now. Home Assistant is backed up too, on its own host."}</p>
      </div>
      {testing ? <Steps steps={steps} current={1} /> : null}
      <div className="btns" style={{ marginTop: "auto" }}>
        <Button variant="primary" onClick={() => void backUpNow()} disabled={testing}><Icon n="download" c="sm" />Back up now</Button>
        <Button onClick={() => void testLatest()} disabled={testing || !latest}><Icon n="shieldcheck" c="sm" />Run restore test</Button>
      </div>
    </Tile>
    <Tile id="bdest" cols={5} rows={3} colsTablet={6}>
      <TileHeader title="Where and when" />
      {set ? <div className="kv">
        <div><span>Destination</span><span><Segmented value={set.destination === "nas" ? "NAS" : "Local disk"} label="Destination" items={[["Local disk", "This server"], ["NAS", "NAS"]]} onChange={(d) => { if (d === "NAS") { ADM.bset!.destination = "nas"; bump(); } else void saveBackupSettings({ destination: "local" }); }} /></span></div>
        {set.destination === "nas" ? <div><span>Folder</span><span style={{ display: "flex", gap: 6 }}><Input className="inp--mono" placeholder="/mnt/nas/alice" aria-label="NAS folder" value={ADM.nasDraft} onChange={(e) => { ADM.nasDraft = e.target.value; bump(); }} /><Button size="sm" onClick={() => void saveBackupSettings({ destination: "nas", nasPath: ADM.nasDraft.trim() })} disabled={!ADM.nasDraft.trim()}>Use</Button></span></div> : null}
        <div><span>Encryption</span><span>{ADM.encryption ? "On, household key" : "Off (set a backup key)"}</span></div>
        <div><span>Nightly backup</span><span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}><Switch checked={set.enabled} label="Nightly backup" onChange={() => void saveBackupSettings({ enabled: !set.enabled })} /><TimeField label="Backup time" value={set.time} disabled={!set.enabled} onChange={(v) => void saveBackupSettings({ time: v })} /></span></div>
        <div><span>Keeps</span><Stepper label="Backups to keep" value={set.keep} min={1} max={90} unit="backups" onChange={(n) => void saveBackupSettings({ keep: n })} /></div>
        <div><span>Home Assistant too</span><Switch checked={set.includeHa} label="Include Home Assistant in nightly backups" onChange={() => void saveBackupSettings({ includeHa: !set.includeHa })} /></div>
      </div> : null}
    </Tile>
    <Tile id="bhist" cols={12} rows={3} colsTablet={6}>
      <TileHeader title="Recent backups" />
      <Table head={["When", "Size", "Where", "Status", ""]} rows={ADM.backups.slice(0, 8).map((x: BackupItem) => [
        ago(x.createdAt), <span key="s" className="num">{size(x.sizeBytes)}</span>, `${x.kind === "ha" ? "Home Assistant" : "Alice"} · ${WHERE[x.destination] ?? x.destination}`,
        <span key="v">{x.status === "failed" ? <Pill tone="warn" icon="alert">Failed</Pill> : x.status === "running" ? <Pill tone="info" icon="clock">Working…</Pill> : <Pill tone={x.verify.status === "passed" ? "ok" : x.verify.status === "failed" ? "warn" : "info"} icon={x.verify.status === "passed" ? "check" : "clock"}>{x.verify.status === "passed" ? "Verified" : x.verify.status === "failed" ? "Test failed" : x.verify.status === "running" ? "Testing…" : "Not tested yet"}</Pill>} <span className="small">{x.error ?? x.verify.note ?? ""}</span></span>,
        <span key="a" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          {x.status === "ok" ? <Button size="sm" onClick={() => void verifyBackup(x.id)}>Test</Button> : null}
          {x.status === "ok" && x.kind === "app" ? <Button size="sm" onClick={() => void downloadBackup(x)}>Download</Button> : null}
          {x.status === "ok" ? <Button size="sm" onClick={() => passkey(`Restore ${ago(x.createdAt)}?`, x.kind === "ha" ? "Home Assistant restores this backup and restarts. Alice reconnects by itself." : "Alice stages this backup and swaps it in the next time it starts. Everything since is replaced. Your current data is kept beside it.", () => void restoreBackup(x))}>Restore</Button> : null}
          <Button size="sm" onClick={() => passkey("Delete this backup?", x.kind === "ha" ? "It is deleted from Home Assistant too." : "The file is deleted from where it is kept.", () => void deleteBackup(x.id))}>Delete</Button>
        </span>,
      ])} />
    </Tile>
  </>;
}

const CHECK: Record<string, [string, string]> = {
  database: ["Database", "disk"], homeAssistant: ["Home Assistant", "home"], configWorker: ["Config helper", "server"], configJobs: ["Home Assistant changes", "layers"],
  push: ["Push alerts", "bell"], backups: ["Backups", "shieldcheck"], updates: ["Updates", "rocket"],
};
const TONE = { ok: "ok", warn: "warn", down: "warn" } as const;
const WORD = { ok: "Working", warn: "Needs a look", down: "Down" } as const;
const uptime = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);

function Health() {
  const h = ADM.health, d = ADM.diag;
  if (!h) return <Tile id="hload" cols={12} rows={1} colsTablet={6}><p className="muted" role="status">Checking…</p></Tile>;
  const all = h.status === "ok";
  return <>
    <Tile id="hhead" cols={12} rows={1} colsTablet={6}>
      <div className="th">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}><Pill tone={all ? "ok" : "warn"} icon={all ? "check" : "alert"} style={{ padding: "6px 12px" }}>{all ? "All systems working" : "Something needs a look"}</Pill><span className="small">{ADM.checking ? "Checking…" : `Checked ${ago(ADM.checkedAt)}`}</span></div>
        <Button size="sm" onClick={() => { void loadHealth().then(bump); }}><Icon n="refresh" c={`sm ${ADM.checking ? "spin" : ""}`} />Check again</Button>
      </div>
    </Tile>
    {h.checks.map((c) => {
      const [label, icon] = CHECK[c.name] ?? [c.name, "pulse"];
      return (
        <Tile key={c.name} id={"h" + c.name} cols={3} rows={2} colsTablet={3} colsMobile={3}>
          <div className="th"><span className="dico"><Icon n={icon} /></span><Pill tone={TONE[c.status]} icon={c.status === "ok" ? "check" : "alert"}>{WORD[c.status]}</Pill></div>
          <div className="hsvc"><b style={{ font: "650 17px var(--f-display)" }}>{label}</b><span className="m">{c.detail}</span></div>
        </Tile>
      );
    })}
    <Tile id="haud" cols={12} rows={3} colsTablet={6}>
      <TileHeader title="Who did what" right={<Pill>Admins only</Pill>} />
      <label className="field"><span className="small">Show</span>
        <Select label="Filter the log" value={ADM.auditFilter} onChange={(v) => void setAuditFilter(v)} options={[["", "Everything"], ["auth.", "Sign-ins"], ["household.", "People and invites"], ["automations.", "Automations"], ["backup.", "Backups"], ["update.", "Updates"], ["support.", "Support access"], ["ha.", "Home Assistant"], ["devices.", "Devices"]]} /></label>
      {ADM.audit.length ? <Table head={["Time", "Who", "What"]} rows={ADM.audit.map((x) => [ago(x.at), x.who, auditSentence(x.action, x.detail)])} /> : <p className="muted">Nothing recorded yet.</p>}
      {ADM.auditMore ? <Button size="sm" style={{ alignSelf: "flex-start" }} onClick={() => void moreAudit()}>Show more</Button> : null}
    </Tile>
    <Tile id="hdiag" cols={12} rows={1} colsTablet={6}>
      <div className="kv" style={{ width: "100%" }}>
        <div><span>Alice</span><span>{h.version} · up {uptime(h.uptimeSeconds)}</span></div>
        {d ? <><div><span>Devices</span><span>{d.counts.devices} · {d.counts.scenes} scenes · {d.counts.routines} routines · {d.counts.automations} automations</span></div>
          <div><span>Database</span><span>{d.database.sizeBytes == null ? "In memory" : size(d.database.sizeBytes)}</span></div></> : null}
      </div>
    </Tile>
  </>;
}

function Updates() {
  const u = ADM.upd;
  if (!u) return <Tile id="uload" cols={12} rows={1} colsTablet={6}><p className="muted" role="status">Checking…</p></Tile>;
  const busy = u.state === "installing" || u.state === "preparing", ready = u.state === "ready", sched = u.state === "scheduled";
  const em = ADM.em, emOk = em.reason.trim().length >= 8 && em.word === "DEPLOY";
  const notes = (u.available?.notes ?? "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  return <>
    <Tile id="ucur" defaultOpen cols={5} rows={3} colsTablet={6}>
      <TileHeader title="Installed" right={u.available ? (u.available.signed ? <Pill tone="ok" icon="shieldcheck">Signed</Pill> : <Pill tone="warn" icon="alert">Unsigned</Pill>) : null} />
      <div className="big">{u.currentVersion}</div>
      <div className="kv">
        <div><span>Window</span><span>{u.settings.windowStart} to {u.settings.windowEnd}</span></div>
        <div><span>Automatic updates</span><span><label className="field" style={{ gap: 8 }}>{u.settings.autoUpdate ? "On" : "Off"} <Switch checked={u.settings.autoUpdate} label="Automatic updates" onChange={() => void setAutoUpdate(!u.settings.autoUpdate)} /></label></span></div>
        <div><span>Applied by</span><span>Host updater, not this app</span></div>
        {u.checkError ? <div><span>Last check</span><span>{u.checkError}</span></div> : null}
      </div>
    </Tile>
    <Tile id="unew" cols={7} rows={3} colsTablet={6} className={ready ? "t-glow" : ""}>
      {!u.available && !busy ? <><TileHeader title="You are up to date" /><p className="muted">Version {u.currentVersion} is installed. Alice checks for new versions every few hours.</p>
        <div className="btns" style={{ marginTop: "auto" }}><Button onClick={() => void updateAction(() => ok(v1.updates.check.post({})), "Checked")}>Check now</Button></div></> : <>
        <TileHeader title={`Version ${u.available?.version ?? ""} ${busy ? "is installing" : "is ready"}`} right={u.available?.signed ? <Pill tone="ok" icon="check">Signature verified</Pill> : <Pill tone="warn" icon="alert">Not signed</Pill>} />
        {notes.length ? <Safe items={notes} /> : <p className="muted">No release notes.</p>}
        {busy ? <Steps steps={["Backing up first", "Handing over to the host updater", "Waiting for Alice to restart"]} current={u.state === "preparing" ? 0 : 1} />
        : sched ? <>
          <Pill tone="info" icon="clock" style={{ alignSelf: "flex-start" }}>Scheduled for {u.active?.scheduledFor ? clockOf(u.active.scheduledFor) : "the next window"}, after the backups</Pill>
          <Button size="sm" style={{ alignSelf: "flex-start" }} onClick={() => void updateAction(() => ok(v1.updates({ id: u.active!.id }).cancel.post({})), "Schedule cancelled")}>Cancel schedule</Button></>
        : <div className="btns" style={{ marginTop: "auto" }}>
          <Button variant="primary" disabled={!u.installable} onClick={() => void updateAction(() => ok(v1.updates.schedule.post({})), "Scheduled for the next window")}><Icon n="moon" c="sm" />Install in the next window</Button>
          <Button disabled={!u.installable} onClick={() => void updateAction(() => ok(v1.updates.install.post({})), "Installing")}>Install now</Button></div>}
        {!u.installable && u.available ? <small>Alice won’t install an update that isn’t signed by the publisher.</small> : null}
      </>}
    </Tile>
    {ADM.hist.length ? <Tile id="uhist" cols={12} rows={3} colsTablet={6}>
      <TileHeader title="Past updates" />
      <Table head={["When", "Version", "How", "Result", ""]} rows={ADM.hist.slice(0, 6).map((x) => [
        clockOf(x.createdAt), `${x.fromVersion} to ${x.version}`, x.trigger === "emergency" ? `Emergency: ${x.reason ?? ""}` : x.trigger === "auto" ? "Automatic" : "By an admin",
        <Pill key="r" tone={x.status === "done" ? "ok" : x.status === "failed" ? "warn" : "info"} icon={x.status === "done" ? "check" : x.status === "failed" ? "alert" : "clock"}>{x.status.replace("_", " ")}</Pill>,
        ["failed", "done", "installing"].includes(x.status) ? <span key="a" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
          <Button size="sm" onClick={() => passkey(`Go back to ${x.fromVersion}?`, "Alice asks the host updater to put the previous version back. Your data is left as it is.", () => void rollbackUpdate(x.id, false))}>Roll back</Button>
          <Button size="sm" onClick={() => passkey(`Go back to ${x.fromVersion} and restore the data?`, "Also replaces Alice's data with the safety backup taken before this update. Anything since is lost.", () => void rollbackUpdate(x.id, true))}>Roll back with data</Button>
        </span> : "",
      ])} />
    </Tile> : null}
    <Tile id="uem" cols={12} rows={2} colsTablet={6}>
      <TileHeader title="Emergency deploy" eyebrow="Skips the nightly window" right={<Button size="sm" onClick={() => { em.open = !em.open; bump(); }} aria-expanded={em.open}>{em.open ? "Close" : "Open"}</Button>} />
      {em.open ? (
        <div className="danger">
          <p>Use this only to fix a live problem. It is recorded in the audit log with your name.</p>
          <Textarea rows={2} placeholder="What is broken, and why can it not wait?" aria-label="Reason" value={em.reason} onChange={(e) => { em.reason = e.target.value; bump(); }} />
          <div className="field">
            <label className="field"><span className="small">Type DEPLOY to confirm</span>
              <Input className="inp--code" value={em.word} autoComplete="off" onChange={(e) => { em.word = e.target.value; bump(); }} /></label>
            <Button variant="danger" disabled={!emOk || !u.installable} onClick={() => void emergencyDeploy()}><Icon n="rocket" c="sm" />Deploy now</Button>
          </div>
          {!u.available ? <small>There is no newer version to deploy.</small> : null}
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
  const d = ADM.support, a = d?.active ?? null, g = ADM.sup;
  if (!d) return <Tile id="sload" cols={12} rows={1} colsTablet={6}><p className="muted" role="status">Loading…</p></Tile>;
  return <>
    {a ? (
      <Tile id="sact" defaultOpen cols={7} rows={3} colsTablet={6} className="t-deep deep">
        <TileHeader title="Support has access" eyebrow="Time-boxed" right={<Pill tone="warn" icon="clock">Ends on its own</Pill>} />
        <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <Countdown end={a.endsAt} dur={a.durationHours} />
          <div className="grow"><b>Access ends on its own</b>
            <p className="small">Can see: {Object.entries(a.scope).filter((x) => x[1]).map((x) => SCOPE[x[0]]).join(", ") || "nothing"}. It can never unlock a door.</p></div>
        </div>
        <div className="btns" style={{ marginTop: "auto" }}>
          <Button variant="primary" onClick={() => void endSupport(a.id)}>End access now</Button>
          <Button onClick={() => passkey("Add an hour?", "Support keeps access for one more hour. Access can last 24 hours at most.", () => void extendSupport(a.id))} disabled={a.durationHours >= 24}>Add 1 hour</Button>
        </div>
      </Tile>
    ) : (
      <Tile id="sgrant" defaultOpen cols={7} rows={3} colsTablet={6}>
        <TileHeader title="No one has access right now" right={<Pill tone="ok" icon="shieldcheck">Closed</Pill>} />
        <p className="muted">Support can only come in when you let them, for a set time. You decide what they can see.</p>
        <div className="field"><span className="small">For</span>
          <Segmented value={g.hours} label="Duration" items={[1, 4, 24].map((h) => [h, `${h} hour${h > 1 ? "s" : ""}`] as [number, string])} onChange={(h) => { g.hours = h; bump(); }} /></div>
        <div className="opts">{([["health", "System health"], ["devices", "Device list"], ["cameras", "Camera views"], ["control", "Controls"]] as const).map(([k, l]) => (
          <OptionButton key={k} aria-pressed={g.scope[k]} onClick={() => { g.scope[k] = !g.scope[k]; bump(); }}><Icon n={g.scope[k] ? "check" : "plus"} c="sm" />{l}</OptionButton>
        ))}</div>
        <Button variant="primary" style={{ alignSelf: "flex-start", marginTop: "auto" }} disabled={!Object.values(g.scope).some(Boolean)} onClick={() => passkey("Let support in?", `Access lasts ${g.hours} hour${g.hours > 1 ? "s" : ""} and ends on its own.`, () => void grantSupport())}><Icon n="key" c="sm" />Grant access with passkey</Button>
      </Tile>
    )}
    <Tile id="srule" cols={5} rows={3} colsTablet={6}>
      <TileHeader title="How this stays honest" />
      <Safe items={["Every grant ends on its own. You can end it sooner.", "Support can never unlock a door, whatever you allow.", "Support can read, never act: it cannot switch, lock or change anything.", "What you see here is plain language. What support itself does is stored apart, so it cannot be edited from your side."]} />
      <Notice>This records and limits the access you give. Support’s own sign-in is not set up yet, so nothing can connect today.</Notice>
    </Tile>
    <Tile id="hlg" cols={6} rows={3} colsTablet={6}>
      <TileHeader title="What your household sees" right={<Pill>Everyone</Pill>} />
      {d.householdLog.length ? <div className="log">{d.householdLog.slice(0, 6).map((x, i) => <div key={i}><time>{clockOf(x.at)}</time><span>{x.text}</span></div>)}</div> : <p className="muted">Nothing yet.</p>}
    </Tile>
    <Tile id="olg" cols={6} rows={3} colsTablet={6}>
      <TileHeader title="Who did it: operator trail" right={<Pill>Admins only</Pill>} />
      {d.operatorTrail.length ? <Table mono head={["Time", "Who", "Action", "Target"]} rows={d.operatorTrail.slice(0, 6).map((x) => [clockOf(x.at), x.operator, x.action, x.target ?? ""])} /> : <p className="muted">Nothing yet. Anything support does with the access you give appears here.</p>}
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
  useEffect(() => { void loadAdminTab(S.at); }, [S.at]);
  const phone = usePhone(), mounted = useMounted();
  if (!mounted) return null;
  const tabs: [string, string, boolean?][] = [["people", "People"], ["backups", "Backups", ADM.loaded && !ADM.backups.some((b) => b.kind === "app" && b.verify.status === "passed")], ["health", "Health", ADM.health ? ADM.health.status !== "ok" : false], ["updates", "Updates", ADM.upd?.state === "ready"], ["support", "Support access", !!ADM.support?.active]];
  const Body = BODY[S.at] ?? People;
  return (
    <>
      <PageHeader title="Admin">The household’s plumbing. Everything here asks for care, so sensitive steps ask for your passkey.</PageHeader>
      <Tabs label="Admin sections" value={S.at} onChange={(id) => { S.at = id; bump(); }} tabs={tabs.map(([id, label, badge]) => ({ id, label, badge }))} />
      <AccordionContext.Provider value={phone && S.at !== "health" ? accordion : null}><div className="grid"><Body /></div></AccordionContext.Provider>
    </>
  );
}
