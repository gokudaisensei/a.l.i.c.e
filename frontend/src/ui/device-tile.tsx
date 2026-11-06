"use client";
import { useRef, type ReactNode } from "react";
import { Icon } from "./icon";
import { cn } from "./cn";

export interface DeviceTileProps {
  icon: string;
  name: string;
  /** State line under the name, for example "60% · Living room". */
  detail: ReactNode;
  on?: boolean;
  /** Needs attention (an unlocked door, for example). */
  warn?: boolean;
  /** 0–100. Draws a level fill from the bottom, like a dimmer. */
  fill?: number;
  /** Full screen-reader label. */
  label: string;
  onTap: () => void;
  /** Fires after a half-second press. A tap that follows a hold is swallowed. */
  onHold?: () => void;
  onMore?: () => void;
  moreLabel?: string;
}

const HOLD_MS = 430;

/** Phone device tile: tap to toggle, hold (or the chevron) for more controls. */
export function DeviceTile({ icon, name, detail, on, warn, fill, label, onTap, onHold, onMore, moreLabel }: DeviceTileProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const stop = () => { if (timer.current) clearTimeout(timer.current); };
  return (
    <div className="dtw" data-slot="device-tile">
      <button className={cn("dt", on && "is-on", warn && "warn")} aria-label={label}
        onPointerDown={() => { if (!onHold) return; fired.current = false; stop(); timer.current = setTimeout(() => { fired.current = true; onHold(); }, HOLD_MS); }}
        onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => { if (fired.current) { fired.current = false; e.preventDefault(); return; } onTap(); }}>
        {fill !== undefined ? <i className="dfill" style={{ height: `${fill}%` }} /> : null}
        <span className="dico"><Icon n={icon} /></span>
        <span className="dn"><b>{name}</b><small>{detail}</small></span>
      </button>
      {onMore ? <button className="dmore" onClick={onMore} aria-label={moreLabel ?? `More controls for ${name}`}><Icon n="chev" /></button> : null}
    </div>
  );
}

/** Dashed "add" tile that sits at the end of a device grid. */
export function AddTile({ onClick, hint, children }: { onClick: () => void; hint?: ReactNode; children: ReactNode }) {
  return <div className="dtw" data-slot="add-tile"><button className="dt add" onClick={onClick}><Icon n="plus" />{children}{hint ? <small>{hint}</small> : null}</button></div>;
}
