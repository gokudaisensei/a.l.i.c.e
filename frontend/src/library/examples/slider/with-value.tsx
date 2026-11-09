"use client";
import { useState } from "react";
import { Slider } from "@/ui";

export default function WithValue() {
  const [v, setV] = useState(60);
  return <div style={{ maxWidth: 380 }}><Slider showValue valueText={(n) => `${n}%`} value={v} onChange={setV} label="Brightness" /></div>;
}
