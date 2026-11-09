"use client";
import { useState } from "react";
import { Slider } from "@/ui";

export default function WithReset() {
  const [v, setV] = useState(35);
  return (
    <div style={{ maxWidth: 380, display: "grid", gap: 8 }}>
      <Slider showValue valueText={(n) => `${n}%`} value={v} onChange={setV} label="Brightness" resetValue={100} />
      <span className="small">Double-tap the bar to return to 100%.</span>
    </div>
  );
}
