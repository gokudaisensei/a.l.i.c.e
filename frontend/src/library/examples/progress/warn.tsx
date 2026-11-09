"use client";
import { Bar } from "@/ui";

export default function Warn() {
  return (
    <div style={{ maxWidth: 380, display: "grid", gap: 6 }}>
      <Bar percent={92} warn label="Geyser power use" />
      <small>1,840 W of 2,000 W: close to its limit</small>
    </div>
  );
}
