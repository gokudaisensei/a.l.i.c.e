"use client";
import { useState } from "react";
import { Dial, Nudge } from "@/ui";

export default function WithDial() {
  const [t, setT] = useState(22);
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 320, margin: "0 auto" }}>
      <Dial value={t} min={16} max={30} step={0.5} unit="°" label="Target temperature" onCommit={setT} />
      <Nudge label="target temperature" minusDisabled={t <= 16} plusDisabled={t >= 30} onMinus={() => setT(Math.max(16, t - 0.5))} onPlus={() => setT(Math.min(30, t + 0.5))} />
    </div>
  );
}
