"use client";
import { nowS } from "@/lib/store";
import type { Dev } from "@/lib/data";

export function Cam({ d }: { d: Dev }) {
  return (
    <div className="cam">
      <svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true"><path d="M0 62 L40 46 L84 58 L120 40 L160 54 V90 H0Z" fill="#fff" /></svg>
      <span className="rec"><i />LIVE</span><span className="tag">{d.n} · {nowS()}</span>
    </div>
  );
}
