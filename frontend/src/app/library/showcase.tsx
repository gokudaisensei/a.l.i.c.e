"use client";
import { useState, type ReactNode } from "react";
import { AdminToken, ConnectHa, RecoveryCodes } from "@/components/auth";
import {
  ActionRow, AddTile, Loading, Avatar, Bar, BottomSheet, Button, Checkbox, Chip, ConfirmDialog, DeviceTile, LockTile, Modal, ModeButton, Popover, PopoverClose, Progress, SceneCard, Tooltip, Empty, Field, FieldRow, FilterChip, Grid, Icon, IconButton, IconTile, Input, KeyValue,
  OptionButton, OptionGroup, PageHeader, Pill, Safe, Segmented, Select, Slider, Sparkline, StepButton, Steps, Switch, Table, Tabs, Textarea,
  Tile, TileHeader, ICON_PATHS, Notice, Stepper, TimeField, Toast,
} from "@/ui";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ marginBottom: 28 }}><div className="eyebrow" style={{ marginBottom: 10 }}>{title}</div>{children}</section>;
}
const Row = ({ children }: { children: ReactNode }) => <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>;

export function Showcase() {
  const [on, setOn] = useState(true);
  const [v, setV] = useState(60);
  const [seg, setSeg] = useState("Home");
  const [tab, setTab] = useState("one");
  const [opt, setOpt] = useState(true);
  const [room, setRoom] = useState(false);
  const [temp, setTemp] = useState(24);
  const [sel, setSel] = useState("any");
  const [chk, setChk] = useState(true);
  const [pr, setPr] = useState(40);
  const [keep, setKeep] = useState(14);
  const [toastDemo, setToastDemo] = useState(false);
  const [at, setAt] = useState("02:30");
  const [ov, setOv] = useState<null | "confirm" | "modal" | "sheet">(null);
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader title="Component library">Every presentational piece of Alice Home, in one place. These components never read app state.</PageHeader>

      <Block title="Button"><Row>
        <Button>Default</Button><Button variant="primary"><Icon n="check" c="sm" />Primary</Button><Button variant="sage">Sage</Button>
        <Button variant="danger">Danger</Button><Button size="sm">Small</Button><Button disabled>Disabled</Button>
        <IconButton aria-label="Star" active><Icon n="star" /></IconButton><StepButton aria-label="Minus" onClick={() => setTemp(temp - 1)}><Icon n="minus" /></StepButton>
        <b className="num">{temp}°</b><StepButton aria-label="Plus" onClick={() => setTemp(temp + 1)}><Icon n="plus" /></StepButton>
      </Row></Block>

      <Block title="Pill, Chip, FilterChip"><Row>
        <Pill>Neutral</Pill><Pill tone="ok" icon="check">Verified</Pill><Pill tone="warn" icon="alert">Unlocked</Pill><Pill tone="info" icon="moon">Quiet hours</Pill>
        <FilterChip pressed={room} count={4} onClick={() => setRoom(!room)}>Kitchen</FilterChip>
      </Row>
        <div className="hero" style={{ padding: 16, borderRadius: 18, marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }} data-tod="day">
          <Chip icon="lock">2 of 2 locked</Chip><Chip icon="bolt" warn onClick={() => {}}>Near its limit</Chip>
        </div></Block>

      <Block title="Switch, Slider, Segmented, Options"><Row>
        <Switch checked={on} label="Demo" onChange={setOn} />
        <div style={{ width: 220 }}><Slider value={v} onChange={setV} label="Brightness" /></div><b className="num">{v}%</b>
        <Segmented value={seg} onChange={setSeg} label="Mode" items={[["Home", "Home"], ["Away", "Away"], ["Night", "Night"]]} />
      </Row>
        <div style={{ marginTop: 12 }}><OptionGroup>
          <OptionButton pressed={opt} onClick={() => setOpt(!opt)}><Icon n="moon" />Only when it is dark</OptionButton>
          <OptionButton pressed={!opt} onClick={() => setOpt(!opt)}><Icon n="home" />Only when someone is home</OptionButton>
          <OptionButton disabled><Icon n="unlock" />Unlock a door</OptionButton>
        </OptionGroup></div></Block>

      <Block title="Fields"><Row>
        <Field label="Name"><Input placeholder="Name this automation" /></Field>
        <Field label="Days"><Select value={sel} onChange={setSel} label="Days" options={[["any", "Any day"], ["weekdays", "Weekdays"], ["weekends", "Weekends"]]} /></Field>
        <FieldRow><Field label="Time"><Input type="time" defaultValue="18:30" /></Field></FieldRow>
      </Row><div style={{ marginTop: 10 }}><Textarea rows={2} placeholder="What is broken?" style={{ width: "100%" }} /></div></Block>

      <Block title="Data display"><Row>
        <Avatar initial="G" tone={1} /><Avatar initial="M" tone={2} /><Avatar initial="A" tone={3} away /><IconTile icon="bulb" />
        <div style={{ width: 200 }}><Bar percent={62} /></div><div style={{ width: 200 }}><Bar percent={95} warn /></div>
        <div style={{ width: 220 }}><Sparkline values={[1, 2, 1.5, 3, 2.4, 4]} /></div>
      </Row>
        <div style={{ marginTop: 12 }}><Empty>Nothing needs you right now.</Empty></div></Block>

      <Block title="Tabs, Steps, Table, KeyValue, Safe">
        <Tabs label="Demo" value={tab} onChange={setTab} tabs={[{ id: "one", label: "People" }, { id: "two", label: "Backups", badge: true }, { id: "three", label: "Health" }]} />
        <Steps steps={["Copying the backup", "Restoring it", "Checking devices"]} current={1} />
        <Table head={["When", "Size", "Status"]} rows={[["Today, 2:30 am", "41.8 MB", <Pill key="a" tone="ok" icon="check">Verified</Pill>], ["Wed 4 Nov", "41.6 MB", <Pill key="b" tone="warn" icon="clock">Not tested</Pill>]]} />
        <div style={{ margin: "12px 0" }}><KeyValue rows={[["Destination", "NAS"], ["Schedule", "Nightly, 2:30 am"]]} /></div>
        <Safe items={["Runs inside Home Assistant.", { text: "Cameras stay private.", muted: true }, { text: "Passkey required.", icon: "shieldcheck" }]} />
      </Block>

      <Block title="Tile and Grid">
        <Grid>
          <Tile id="demo-a" style={{ "--i": 0 }} cols={4} rows={2}><TileHeader title="Climate" eyebrow="Living room" right={<Switch checked label="AC" onChange={() => {}} />} /><div className="big">25.6°<small>now</small></div></Tile>
          <Tile id="demo-b" style={{ "--i": 1 }} cols={4} rows={2} className="t-sage"><TileHeader title="Backups" right={<Pill tone="ok" icon="shieldcheck">Verified</Pill>} /><p>Tone classes: t-sage, t-clay, t-glow, t-deep.</p></Tile>
          <Tile id="demo-c" style={{ "--i": 2 }} cols={4} rows={2} className="t-deep deep"><TileHeader title="Doors" /><p className="small">Deep tile.</p></Tile>
        </Grid>
      </Block>

      <Block title="Checkbox, Progress">
        <Row>
          <Checkbox checked={chk} onChange={setChk}>Notify me when it stays open</Checkbox>
          <Checkbox checked={false} onChange={() => {}} indeterminate label="Some selected" />
          <Checkbox checked={false} onChange={() => {}} disabled>Disabled</Checkbox>
        </Row>
        <div style={{ display: "grid", gap: 10, maxWidth: 360, marginTop: 10 }}>
          <Progress value={pr} label="Backup progress" />
          <Progress value={92} warn label="Power limit" />
          <div className="btns"><Button size="sm" onClick={() => setPr((v) => (v >= 100 ? 5 : v + 20))}>Advance</Button></div>
        </div>
      </Block>

      <Block title="Stepper, TimeField, ActionRow, Notice">
        <Row>
          <Stepper label="Backups to keep" value={keep} onChange={setKeep} min={1} max={90} unit="backups" />
          <TimeField label="Backup time" value={at} onChange={setAt} />
        </Row>
        <div style={{ display: "grid", gap: 8, maxWidth: 520, marginTop: 10 }}>
          <ActionRow icon="bulb" verb="Turn on" onRemove={() => {}}><span className="small">Floor lamp</span></ActionRow>
          <Notice tone="warn" action={<Button size="sm">Fix it</Button>}>Home Assistant has not been given an administrator token.</Notice>
          <Notice tone="ok">Everything is in step with Home Assistant.</Notice>
          <Notice>Alice checks every 15 minutes.</Notice>
        </div>
      </Block>

      <Block title="Toast">
        <p className="small" style={{ marginBottom: 10 }}>A card, not a pill: it wraps long messages, cuts them after five lines with a tap to read the rest, pauses while pointed at or touched, and warnings are announced straight away. Here they are in the page; in the app they sit at the bottom of the screen.</p>
        <div style={{ display: "grid", gap: 10, justifyItems: "start" }}>
          <Toast placement="inline" show message="Floor lamp on" onDismiss={() => {}} onUndo={() => {}} duration={1_000_000} />
          <Toast placement="inline" show tone="ok" message="Saved. Alice is adding it to Home Assistant" onDismiss={() => {}} duration={1_000_000} />
          <Toast placement="inline" show tone="warn" title="Home Assistant refused it" message="Home Assistant did not accept turning on the Kitchen Door lock because it needs a fresh passkey confirmation, and the confirmation window of five minutes has already passed since you last touched your phone. Confirm with your passkey and try again, or ask an admin to change which actions need a passkey." onDismiss={() => {}} duration={1_000_000} />
        </div>
        <div className="btns" style={{ marginTop: 12 }}><Button size="sm" onClick={() => setToastDemo(true)}>Show one at the bottom</Button></div>
        <Toast show={toastDemo} message="This one sits at the bottom of the screen and goes by itself." onDismiss={() => setToastDemo(false)} onUndo={() => setToastDemo(false)} />
      </Block>

      <Block title="Tooltip, Popover">
        <Row>
          <Tooltip label="Add to favourites"><IconButton aria-label="Add to favourites"><Icon n="star" /></IconButton></Tooltip>
          <Popover trigger={<Button>Open popover</Button>} title="Quiet hours" align="start">
            <p className="small">Alice holds non-urgent alerts between 10:30 pm and 6:30 am.</p>
            <PopoverClose render={<Button size="sm" variant="primary" />}>Got it</PopoverClose>
          </Popover>
        </Row>
      </Block>

      <Block title="Phone tiles">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, maxWidth: 420 }}>
          <DeviceTile icon="bulb" name="Floor lamp" detail="60% · Living room" on fill={60} label="Floor lamp" onTap={() => {}} onHold={() => {}} onMore={() => {}} />
          <DeviceTile icon="lock" name="Back door" detail="Open · Hall" warn label="Back door" onTap={() => {}} />
          <AddTile onClick={() => {}}>Add favourite</AddTile>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 420, marginTop: 10 }}>
          <ModeButton icon="home" label="Home" description="Everyone is in" pressed onClick={() => {}} />
          <ModeButton icon="moon" label="Night" description="Quiet hours" pressed={false} onClick={() => {}} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 420, marginTop: 10 }}>
          <SceneCard icon="play" name="Movie night" description="Ceiling off, lamp 15%" tag="Suggested now" suggested onClick={() => {}} />
          <SceneCard icon="sun" name="Good morning" description="Kitchen lights up" tag="Routine" onClick={() => {}} />
        </div>
        <div className="t-deep deep" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 420, marginTop: 10, padding: 12, borderRadius: 20 }}>
          <LockTile icon="lock" name="Front door" status="Locked" locked label="Front door" onClick={() => {}} />
          <LockTile icon="unlock" name="Back door" status="Open · tap to lock" locked={false} label="Back door" onClick={() => {}} />
        </div>
      </Block>

      <Block title="Button states, Loading">
        <Row>
          <Button variant="primary" loading>Waiting for your passkey…</Button>
          <Button loading>Saving</Button>
          <Button variant="primary" size="lg">Large</Button>
          <Button variant="ghost">Ghost</Button>
        </Row>
        <Loading label="Loading your home…" />
      </Block>

      <Block title="Onboarding screens (static preview)">
        <div className="auth-embed">
          <RecoveryCodes codes={["MAPLE-4829", "KITE-1175", "PINE-9032", "FERN-6641", "OAK-2218", "REED-7750"]} />
          <ConnectHa onDone={() => {}} onSkip={() => {}} />
          <AdminToken onDone={() => {}} onSkip={() => {}} />
        </div>
      </Block>

      <Block title="Overlays (live)">
        <div className="btns">
          <Button onClick={() => setOv("confirm")}>Confirm dialog</Button>
          <Button onClick={() => setOv("modal")}>Modal</Button>
          <Button onClick={() => setOv("sheet")}>Bottom sheet (drag to dismiss)</Button>
        </div>
        <ConfirmDialog open={ov === "confirm"} title="Unlock Front door?" description="Unlocking always needs your passkey." state="idle" onConfirm={() => setOv(null)} onCancel={() => setOv(null)} />
        <Modal open={ov === "modal"} onOpenChange={(o) => !o && setOv(null)} label="Example modal"><div style={{ padding: 24 }}><h3 className="tt">Modal</h3><p className="muted">Focus is trapped here. Escape or a tap outside closes it.</p></div></Modal>
        <BottomSheet open={ov === "sheet"} onOpenChange={(o) => !o && setOv(null)} label="Example sheet"><h3 className="tt">Bottom sheet</h3><p className="muted">Drag the sheet down, or flick it, to dismiss.</p><Slider value={v} onChange={setV} label="Demo" size="xl" /></BottomSheet>
      </Block>

      <Block title={`Icons (${Object.keys(ICON_PATHS).length})`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))", gap: 10 }}>
          {Object.keys(ICON_PATHS).map((k) => <div key={k} style={{ display: "grid", justifyItems: "center", gap: 6, padding: 10, borderRadius: 14, background: "var(--tile)" }}><Icon n={k} c="lg" /><small>{k}</small></div>)}
        </div>
      </Block>
    </div>
  );
}
