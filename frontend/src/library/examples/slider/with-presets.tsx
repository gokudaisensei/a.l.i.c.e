"use client";
import { useState } from "react";
import { Button, Slider } from "@/ui";

export default function WithPresets() {
  const [v, setV] = useState(50);
  return (
    <div style={{ maxWidth: 420, display: "grid", gap: 12 }}>
      <Slider value={v} onChange={setV} label="Brightness" />
      <div className="presets">{[25, 50, 75, 100].map((n) => <Button key={n} onClick={() => setV(n)}>{n}%</Button>)}</div>
    </div>
  );
}
