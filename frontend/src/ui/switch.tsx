"use client";
import { useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent } from "react";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "./cn";
import { haptic } from "./haptics";

export interface SwitchProps extends Omit<ComponentProps<typeof BaseSwitch.Root>, "checked" | "defaultChecked" | "onCheckedChange" | "className" | "children" | "aria-label" | "disabled"> {
  checked: boolean;
  /** Accessible name. Required because the switch has no visible text. */
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * On/off switch. Tap it, or drag the thumb across and let go: it lands on whichever side it is nearer to, with a bump as it
 * crosses the middle. The thumb stretches while pressed and settles with a light spring; on and off feel different.
 */
export function Switch({ checked, label, onChange, disabled, className, style, onPointerDown, onPointerMove, onPointerUp, onClickCapture, ...rest }: SwitchProps) {
  const [pos, setPos] = useState<number | null>(null); // 0 to 1 while the thumb is being dragged
  const press = useRef<{ id: number; x: number; moved: boolean; side: boolean } | null>(null);
  const swallow = useRef(false);
  const set = (next: boolean) => { haptic(next ? "toggleOn" : "toggleOff"); onChange(next); };

  const move = (e: PointerEvent<HTMLElement>) => {
    const p = press.current; if (!p || e.pointerId !== p.id) return;
    if (!p.moved) { if (Math.abs(e.clientX - p.x) < 5) return; p.moved = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the drag still works inside the switch */ } }
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left - 14) / (r.width - 28)));
    if (f >= 0.5 !== p.side) { p.side = f >= 0.5; haptic("detent"); } // a bump as it crosses the middle
    setPos(f);
  };
  const up = () => {
    const p = press.current; press.current = null;
    if (!p?.moved) return;
    swallow.current = true; setTimeout(() => { swallow.current = false; }, 0);
    const next = (pos ?? (checked ? 1 : 0)) >= 0.5;
    setPos(null);
    if (next !== checked) set(next);
  };
  return (
    <BaseSwitch.Root data-slot="switch" className={cn("sw", className)} checked={checked} disabled={disabled} aria-label={label} onCheckedChange={set}
      data-dragging={pos !== null ? "" : undefined} data-drag-on={pos !== null && pos >= 0.5 ? "" : undefined}
      style={pos !== null ? ({ ...style, "--sw-pos": pos } as CSSProperties) : style}
      onPointerDown={(e) => { onPointerDown?.(e); if (!disabled) press.current = { id: e.pointerId, x: e.clientX, moved: false, side: checked }; }}
      onPointerMove={(e) => { onPointerMove?.(e); move(e); }}
      onPointerUp={(e) => { onPointerUp?.(e); up(); }}
      onPointerCancel={() => { press.current = null; setPos(null); }}
      onClickCapture={(e) => { onClickCapture?.(e); if (swallow.current) { e.stopPropagation(); e.preventDefault(); } }}
      {...rest}>
      <BaseSwitch.Thumb className="sw-t" />
    </BaseSwitch.Root>
  );
}
