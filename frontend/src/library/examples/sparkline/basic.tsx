"use client";
import { Sparkline } from "@/ui";

export default function Basic() {
  return (
    <div style={{ maxWidth: 260, display: "grid", gap: 6 }}>
      <div className="mini-big">0.10<small> kW</small></div>
      <Sparkline values={[1, 2, 1.5, 3, 2.4, 4, 3.2]} label="Power use today, rising through the afternoon" />
    </div>
  );
}
