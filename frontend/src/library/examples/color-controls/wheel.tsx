"use client";
import { useState } from "react";
import { ColorWheel } from "@/ui";

export default function Wheel() {
  const [c, setC] = useState<[number, number, number]>([255, 120, 60]);
  return <div style={{ display: "grid", gap: 12, justifyItems: "center" }}><ColorWheel rgb={c} onCommit={setC} label="Lamp colour" /><span className="small num">rgb({c.join(", ")})</span></div>;
}
