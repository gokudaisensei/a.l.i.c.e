"use client";
import { useState } from "react";
import { AddTile, DeviceTile } from "@/ui";

export default function PlainAndAdd() {
  const [on, setOn] = useState(false);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, maxWidth: 420 }}>
      <DeviceTile icon="plug" name="Water heater" detail={on ? "1,200 W" : "Off"} on={on} onTap={() => setOn(!on)} onMore={() => {}} />
      <DeviceTile icon="unlock" name="Back door" detail="Open · Hall" warn hint="Tap to lock." onTap={() => {}} />
      <AddTile onClick={() => {}} hint="Pin a device">Add favourite</AddTile>
    </div>
  );
}
