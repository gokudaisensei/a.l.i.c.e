"use client";
import { useState } from "react";
import { Nudge, Slider } from "@/ui";

export default function WithSlider() {
  const [v, setV] = useState(60);
  return (
    <div style={{ maxWidth: 380, display: "grid", gap: 12 }}>
      <Slider size="xl" value={v} onChange={setV} label="Brightness" valueText={(n) => `${n}%`} />
      <Nudge label="brightness" minusDisabled={v <= 5} plusDisabled={v >= 100} onMinus={() => setV(Math.max(5, v - 5))} onPlus={() => setV(Math.min(100, v + 5))} />
    </div>
  );
}
