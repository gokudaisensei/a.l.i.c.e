"use client";
import { useState } from "react";
import { DeviceTile } from "@/ui";

export default function Lamp() {
  const [v, setV] = useState(60);
  return (
    <div style={{ width: 180 }}>
      <DeviceTile icon="bulb" name="Floor lamp" detail={v ? `${v}% · drag sideways` : "Off · drag sideways"} on={v > 0} fill={v} tint="rgb(255 120 60)"
        dragValue={v} onDragCommit={setV} hint="Tap to toggle. Hold for more." onTap={() => setV(v ? 0 : 60)} onHold={() => {}} onMore={() => {}} />
    </div>
  );
}
