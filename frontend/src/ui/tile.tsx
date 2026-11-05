"use client";
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

/**
 * Phone-only accordion for tiles. Provide this above a grid and every `Tile` inside
 * becomes collapsible. The library holds no state: `isOpen` and `toggle` are yours.
 */
export interface AccordionApi { scope: string; isOpen: (key: string, fallback: boolean) => boolean; toggle: (key: string, nextOpen: boolean) => void }
export const AccordionContext = createContext<AccordionApi | null>(null);
const TileKey = createContext<{ key: string; open: boolean; api: AccordionApi } | null>(null);

let counter = 0;
/** Reset the stagger counter at the top of each view so tiles animate in order. */
export const resetTileOrder = () => { counter = 0; };

type Vars = CSSProperties & Record<`--${string}`, string | number>;

export interface TileProps {
  id: string;
  /** Column span on desktop, tablet and phone-wide grids. */
  cols?: number; colsTablet?: number; colsMobile?: number;
  /** Row span. */
  rows?: number;
  /** Colour treatment: sage, clay, glow, deep, or hero. */
  tone?: string;
  className?: string;
  /** Skip the card chrome. Used for phone layouts that style themselves. */
  bare?: boolean;
  style?: CSSProperties;
  /** Start expanded when inside an accordion. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Tile({ id, cols = 4, colsTablet = 3, colsMobile = 6, rows = 2, tone, className, bare, style, defaultOpen, children }: TileProps) {
  const api = useContext(AccordionContext);
  const cls = cn(tone && (tone === "hero" ? "hero" : `t-${tone}`), tone === "deep" && "deep", className);
  if (bare) return <section className={cls} id={`t-${id}`} style={style}>{children}</section>;
  const order = counter++;
  const vars: Vars = { "--c": cols, "--r": rows, "--ct": colsTablet, "--cm": colsMobile, "--i": order, ...style };
  const key = api ? `${api.scope}:t-${id}` : null;
  const open = key && api ? api.isOpen(key, !!defaultOpen) : false;
  return (
    <TileKey.Provider value={key && api ? { key, open, api } : null}>
      <section className={cn("tile", cls, key && "aacc", key && open && "open")} id={`t-${id}`} style={vars}>{children}</section>
    </TileKey.Provider>
  );
}

/** Tile header: title, optional eyebrow above it, optional trailing control. */
export function TileHeader({ title, eyebrow, right }: { title?: ReactNode; eyebrow?: ReactNode; right?: ReactNode }) {
  const acc = useContext(TileKey);
  const toggle = () => acc?.api.toggle(acc.key, !acc.open);
  return (
    <div className="th" {...(acc ? { role: "button", tabIndex: 0, onClick: toggle, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } } : {})}>
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h3>{title}</h3>
      </div>
      {right}
      {acc ? <Icon n="chev" c="sm accv" /> : null}
    </div>
  );
}

/** Auto-fitting 12-column bento grid. */
export function Grid({ children }: { children: ReactNode }) { return <div className="grid">{children}</div>; }
