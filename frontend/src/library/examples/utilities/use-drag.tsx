"use client";
import { useState } from "react";
import { project, useDrag } from "@/ui";

export default function UseDrag() {
  const [x, setX] = useState(0.5);
  const [gliding, setGliding] = useState(false); // the handle follows the finger exactly while held, and glides after release
  const drag = useDrag((fx) => { setGliding(false); setX(fx); }, (fx, _y, _el, v) => { setGliding(true); setX(Math.min(1, Math.max(0, project(fx, v.vx)))); });
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 360 }}>
      <div {...drag} style={{ position: "relative", height: 56, borderRadius: 16, background: "var(--tile2)", touchAction: "none", cursor: "ew-resize" }} role="presentation">
        <i style={{ position: "absolute", top: 8, bottom: 8, left: `calc(${x * 100}% - 4px)`, width: 8, borderRadius: 6, background: "var(--ink)", transition: gliding ? "left .45s var(--ease-out)" : "none" }} />
      </div>
      <span className="small num">x = {x.toFixed(2)}</span>
    </div>
  );
}
