import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/** Horizontal meter. `warn` turns it clay. */
export function Bar({ percent, warn }: { percent: number; warn?: boolean }) {
  return <div className={cn("bar", warn && "warn")}><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></div>;
}

/** Round initial. `tone` 1–4 picks the colour; `away` greys it. */
export function Avatar({ initial, tone, away }: { initial: string; tone: number; away?: boolean }) {
  return <span className={cn("av", `a${tone}`, away && "away")}>{initial}</span>;
}

/** Square icon holder used at the start of rows. */
export function IconTile({ icon, style }: { icon: string; style?: CSSProperties }) {
  return <span className="dico" style={style}><Icon n={icon} /></span>;
}

export function Empty({ children, style }: { children: ReactNode; style?: CSSProperties }) { return <div className="empty" style={style}>{children}</div>; }

/** Checklist-style list of reassurances. `muted` rows use a cross. */
export function Safe({ items }: { items: (string | { text: string; muted?: boolean; icon?: string })[] }) {
  return (
    <div className="safe">{items.map((it) => {
      const o = typeof it === "string" ? { text: it, muted: false } : { muted: false, ...it };
      return <div key={o.text} style={o.muted ? { color: "var(--ink3)" } : undefined}><Icon n={o.icon ?? (o.muted ? "x" : "check")} /><span>{o.text}</span></div>;
    })}</div>
  );
}

/** Key/value rows. */
export function KeyValue({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return <div className="kv">{rows.map(([k, v], i) => <div key={i}><span>{k}</span><span>{v}</span></div>)}</div>;
}

/** Step list for multi-stage jobs. `current` is the active step index. */
export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="steps">{steps.map((s, i) => (
      <div key={s} className={cn("stp", i < current ? "done" : i === current && "on")}>
        <Icon n={i < current ? "check" : i === current ? "refresh" : "clock"} c={i === current ? "spin" : ""} />{s}
      </div>
    ))}</div>
  );
}

export function Table({ head, rows, mono }: { head: string[]; rows: ReactNode[][]; mono?: boolean }) {
  return (
    <div className="tscroll"><table className={cn("table", mono && "mono")} style={mono ? { fontSize: 12 } : undefined}>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

/** Underlined section switcher. */
export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { id: T; label: string; badge?: boolean }[]; onChange: (id: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>{tabs.map((t) => (
      <button key={t.id} type="button" className="tab" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
        {t.label}{t.badge ? <span className="dotb" title="Needs a look" /> : null}
      </button>
    ))}</div>
  );
}

/** Page title block. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="ph"><div><h1>{title}</h1>{children ? <p>{children}</p> : null}</div></div>;
}

/** Trusted in-app HTML (activity strings that carry <b>). Never pass user input. */
export function Html({ html, as: T = "span" }: { html: string; as?: "span" | "div" | "small" }) {
  return <T dangerouslySetInnerHTML={{ __html: html }} />;
}
