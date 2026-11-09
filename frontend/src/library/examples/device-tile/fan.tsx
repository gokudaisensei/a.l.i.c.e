"use client";
import { useState } from "react";
import { DeviceTile } from "@/ui";

export default function Fan() {
  const [pct, setPct] = useState(66);
  return (
    <div style={{ width: 180 }}>
      <DeviceTile icon="fan" name="Standing fan" detail={pct ? `${pct}%` : "Off"} on={pct > 0} fill={pct} spin={pct ? Math.max(0.35, 2.4 - pct / 50) : undefined}
        dragValue={pct} onDragCommit={setPct} hint="Tap to toggle." onTap={() => setPct(pct ? 0 : 66)} onMore={() => {}} />
    </div>
  );
}
