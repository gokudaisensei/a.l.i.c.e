"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, HAPTICS, ICON_PATHS, Icon, Segmented, Switch, haptic, hapticsSupported, useHapticsEnabled, type Haptic } from "@/ui";

/* ------------------------------------------------------------------ colour */
const GROUPS: { title: string; note: string; tokens: [string, string][] }[] = [
  { title: "Ground", note: "The page and the surfaces on it.", tokens: [["--bg", "Page"], ["--tile", "Cards, tiles, controls"], ["--tile2", "Wells, inactive controls"]] },
  { title: "Ink", note: "Text, from strongest to a hint, and hairlines.", tokens: [["--ink", "Primary text"], ["--ink2", "Secondary text"], ["--ink3", "Hints"], ["--line", "Hairlines"]] },
  { title: "Anchor", note: "Calm and confirming: the primary sage.", tokens: [["--sage", "Primary actions"], ["--sage-soft", "Soft sage fill"]] },
  { title: "Glow", note: "On and active. Never decoration.", tokens: [["--glow", "A lit device, a filled bar"], ["--glow-soft", "A lit tile"], ["--glow-ink", "Text on a lit tile"]] },
  { title: "Warmth", note: "Needs attention, but is not an emergency.", tokens: [["--clay", "Unlocked, left open"], ["--clay-soft", "Soft clay fill"]] },
  { title: "Status", note: "Done, caution, failure.", tokens: [["--ok", "Confirmation"], ["--ok-soft", ""], ["--warn", "Caution"], ["--warn-soft", ""], ["--crit", "Failure"], ["--crit-soft", ""]] },
  { title: "Night", note: "The deep surfaces.", tokens: [["--deep", "Night surfaces"], ["--deep-ink", "Text on them"]] },
];
const PAIRS: [string, string, string, number][] = [
  ["--ink", "--tile", "Body text on a card", 4.5], ["--ink2", "--tile", "Secondary text on a card", 4.5], ["--ink3", "--tile", "Hints on a card", 3],
  ["--ink", "--bg", "Body text on the page", 4.5], ["--on-sage", "--sage", "Text on a sage button", 4.5], ["--glow-ink", "--glow-soft", "Text on a lit tile", 4.5],
  ["--clay", "--clay-soft", "Clay on its soft fill", 3], ["--ok", "--ok-soft", "Ok on its soft fill", 3], ["--warn", "--warn-soft", "Warn on its soft fill", 4.5], ["--crit", "--crit-soft", "Crit on its soft fill", 4.5],
  ["--deep-ink", "--deep", "Text on night surfaces", 4.5],
];
const rgb = (s: string): [number, number, number] => { const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0]; return [m[0], m[1], m[2]]; };
const lum = ([r, g, b]: [number, number, number]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = ([r, g, b]: [number, number, number]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Reads the real values from the page, so it is right in light and dark and can never drift from the tokens. */
export function Colors() {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const probe = document.createElement("i"); document.body.appendChild(probe);
      const out: Record<string, string> = {};
      for (const name of [...GROUPS.flatMap((g) => g.tokens.map(([t]) => t)), "--on-sage"]) { probe.style.color = `var(${name})`; out[name] = getComputedStyle(probe).color; }
      probe.remove(); setVals(out);
    };
    read();
    const mo = new MutationObserver(read); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const mq = matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", read);
    return () => { mo.disconnect(); mq.removeEventListener("change", read); };
  }, []);
  return (
    <div className="lib-prose">
      {GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title}>
          <h2>{g.title}</h2><p className="lib-note">{g.note}</p>
          <div className="lib-swatches">{g.tokens.map(([t, role]) => (
            <div key={t} className="lib-swatch"><i style={{ background: `var(${t})` }} /><div><b>{t}</b>{role ? <span>{role}</span> : null}<small>{vals[t] ? (vals[t].startsWith("rgba") ? vals[t] : hex(rgb(vals[t]))) : " "}</small></div></div>
          ))}</div>
        </section>
      ))}
      <section aria-label="Contrast"><h2>Contrast, measured live</h2>
        <p className="lib-note">Computed from the colours above in the current theme. Body text should reach 4.5:1; large text, icons and borders 3:1. Switch the theme in the header to see the other set.</p>
        <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Pair</th><th>Ratio</th><th>Needs</th><th>Result</th></tr></thead>
          <tbody>{PAIRS.map(([f, b, name, need]) => { const r = vals[f] && vals[b] ? ratio(rgb(vals[f]), rgb(vals[b])) : 0; return (
            <tr key={f + b}><td>{name}<br /><small><code>{f}</code> on <code>{b}</code></small></td><td className="num">{r ? r.toFixed(2) + ":1" : "…"}</td><td>{need}:1</td><td>{r ? (r >= need ? "Passes" : <b style={{ color: "var(--crit)" }}>Below</b>) : ""}</td></tr>); })}</tbody></table></div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ motion */
const CURVES: [string, string, string][] = [
  ["--ease-ios", "Sheets, sliding thumbs, fills gliding to a new value", "var(--ease-ios)"],
  ["--ease-out", "Things arriving", "var(--ease-out)"],
  ["--ease-in", "Things leaving", "var(--ease-in)"],
  ["--spring", "Releases, toggles, thumbs lifting (about 3% overshoot)", "var(--spring)"],
];
export function Motion() {
  const [go, setGo] = useState(false);
  return (
    <div className="lib-prose">
      <div className="btns"><Button variant="primary" onClick={() => setGo((g) => !g)}>Play</Button></div>
      <div role="list">{CURVES.map(([name, use, fn]) => (
        <div key={name} className="lib-curve" role="listitem">
          <div><code>{name}</code><div className="lib-note">{use}</div></div>
          <div className="lib-track" data-go={go || undefined}><i className="lib-dot" style={{ transition: `left .9s ${fn}` }} /></div>
        </div>
      ))}</div>
      <h2>Durations</h2>
      <ul><li><code>--t-press</code> .1 s: press feedback comes in fast.</li><li><code>--t-release</code> .5 s: it settles on the spring.</li><li><code>--t-ui</code> .3 s: ordinary changes.</li><li><code>--t-sheet</code> .45 s: sheets and dialogs.</li></ul>
    </div>
  );
}

/* ------------------------------------------------------------------- icons */
export function Icons() {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState("");
  const names = useMemo(() => Object.keys(ICON_PATHS).sort(), []);
  const shown = names.filter((n) => n.includes(q.trim().toLowerCase()));
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <label className="lib-search" style={{ maxWidth: 360 }}><Icon n="search" c="sm" /><span className="sr">Search icons</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${names.length} icons`} type="search" /></label>
      <div className="lib-icons">{shown.map((n) => (
        <button key={n} type="button" className="lib-icon" onClick={async () => { try { await navigator.clipboard.writeText(n); setCopied(n); setTimeout(() => setCopied(""), 1200); } catch {} }} aria-label={`Copy the name ${n}`}>
          <Icon n={n} c="lg" /><span>{copied === n ? "Copied" : n}</span>
        </button>
      ))}</div>
      {!shown.length ? <p className="lib-note">No icon matches “{q}”.</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------- materials */
export function Materials() {
  const [solid, setSolid] = useState("glass");
  return (
    <div className="lib-prose">
      <Segmented value={solid} onChange={setSolid} label="Material" items={[["glass", "Glass"], ["solid", "Solid fallback"]]} />
      <div className="lib-glassbed">
        <div className={solid === "glass" ? "glass" : ""} style={{ padding: "12px 18px", borderRadius: 26, background: solid === "glass" ? undefined : "var(--tile)", boxShadow: solid === "glass" ? undefined : "inset 0 0 0 1px var(--line)", position: "relative" }}>Tab bar <b>Home</b> Rooms Automate</div>
        <div className={solid === "glass" ? "glass" : ""} style={{ padding: "12px 18px", borderRadius: 18, background: solid === "glass" ? undefined : "var(--tile)", boxShadow: solid === "glass" ? undefined : "inset 0 0 0 1px var(--line)", position: "relative" }}>Toast or popover</div>
      </div>
      <p className="lib-note">Behind both is a stripy, colourful background, so you can see what the glass does to it. Reduce Transparency and Increase Contrast switch every surface to the solid version.</p>
    </div>
  );
}

/* --------------------------------------------------------------- text size */
export function TextSize() {
  const [tier, setTier] = useState("…");
  const [px, setPx] = useState(0);
  useEffect(() => {
    const read = () => { setTier(document.documentElement.dataset.text ?? "std"); setPx(parseFloat(getComputedStyle(document.documentElement).fontSize)); };
    read(); addEventListener("resize", read); const t = setInterval(read, 800);
    return () => { removeEventListener("resize", read); clearInterval(t); };
  }, []);
  return <div className="lib-demo"><span>This page’s text tier is</span><code className="lib-badge">{tier}</code><span>and the root text size is <b className="num">{px}px</b>. The Text size control on an example changes that example’s frame only; to change this page, change your browser or phone’s text size.</span></div>;
}

/* ----------------------------------------------------------------- haptics */
export function HapticsLab() {
  const [on, setOn] = useHapticsEnabled();
  const supported = useSyncExternalStore(() => () => {}, () => hapticsSupported(), () => null as boolean | null); // unknown on the server, known in the browser
  const [last, setLast] = useState("");
  return (
    <div className="lib-prose" style={{ maxWidth: "none" }}>
      <div className="lib-demo">
        <label className="field"><span>Haptics on this device</span><Switch checked={on} onChange={setOn} label="Haptics on this device" /></label>
        <span className="lib-note" style={{ margin: 0 }}>{supported === null ? "" : supported ? "This browser can vibrate: press a button below and feel it." : "This browser cannot vibrate (desktop browsers and iPhone Safari before the switch trick usually cannot), so the buttons do nothing here. Try it on an Android phone."}</span>
      </div>
      <div className="lib-scroll"><table className="lib-table"><thead><tr><th>Haptic</th><th>Feels like</th><th>When</th><th>Try it</th></tr></thead>
        <tbody>{(Object.keys(HAPTICS) as Haptic[]).map((k) => (
          <tr key={k}><td><code>{k}</code></td><td className="num">{Array.isArray(HAPTICS[k].pattern) ? HAPTICS[k].pattern.join(" · ") : HAPTICS[k].pattern} ms</td><td>{HAPTICS[k].use}</td>
            <td><Button size="sm" onClick={() => { haptic(k); setLast(k); }}>{HAPTICS[k].label}</Button></td></tr>
        ))}</tbody></table></div>
      <p className="lib-note" role="status">{last ? `Played ${last}.` : ""}</p>
    </div>
  );
}
