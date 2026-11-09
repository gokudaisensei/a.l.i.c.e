"use client";
import { useState } from "react";
import { Slider } from "@/ui";

export default function Basic() {
  const [v, setV] = useState(60);
  return <div style={{ maxWidth: 360, display: "grid", gap: 8 }}><Slider value={v} onChange={setV} label="Brightness" /><span className="small num">Brightness {v}%</span></div>;
}
