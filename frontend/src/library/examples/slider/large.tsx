"use client";
import { useState } from "react";
import { Slider } from "@/ui";

export default function Large() {
  const [v, setV] = useState(45);
  return <div style={{ display: "grid", gap: 8 }}><div className="sbig">{v}%</div><Slider size="xl" value={v} onChange={setV} label="Brightness" /></div>;
}
