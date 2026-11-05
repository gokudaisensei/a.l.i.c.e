"use client";
import { useState, type ReactNode } from "react";
import {
  Avatar, Bar, Button, Chip, ConfirmDialog, Empty, Field, FieldRow, FilterChip, Grid, Icon, IconButton, IconTile, Input, KeyValue,
  OptionButton, OptionGroup, PageHeader, Pill, Safe, Segmented, Select, Slider, Sparkline, StepButton, Steps, Switch, Table, Tabs, Textarea,
  Tile, TileHeader, ICON_PATHS,
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
        <Field label="Days"><Select defaultValue="any" options={[["any", "Any day"], ["weekdays", "Weekdays"]]} /></Field>
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
          <Tile id="demo-a" cols={4} rows={2}><TileHeader title="Climate" eyebrow="Living room" right={<Switch checked label="AC" onChange={() => {}} />} /><div className="big">25.6°<small>now</small></div></Tile>
          <Tile id="demo-b" cols={4} rows={2} className="t-sage"><TileHeader title="Backups" right={<Pill tone="ok" icon="shieldcheck">Verified</Pill>} /><p>Tone classes: t-sage, t-clay, t-glow, t-deep.</p></Tile>
          <Tile id="demo-c" cols={4} rows={2} className="t-deep deep"><TileHeader title="Doors" /><p className="small">Deep tile.</p></Tile>
        </Grid>
      </Block>

      <Block title="Confirm dialog (static preview)">
        <div style={{ display: "grid", placeItems: "center" }}><ConfirmDialog title="Unlock Front door?" description="Unlocking always needs your passkey." state="idle" onConfirm={() => {}} onCancel={() => {}} /></div>
      </Block>

      <Block title={`Icons (${Object.keys(ICON_PATHS).length})`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))", gap: 10 }}>
          {Object.keys(ICON_PATHS).map((k) => <div key={k} style={{ display: "grid", justifyItems: "center", gap: 6, padding: 10, borderRadius: 14, background: "var(--tile)" }}><Icon n={k} c="lg" /><small>{k}</small></div>)}
        </div>
      </Block>
    </div>
  );
}
