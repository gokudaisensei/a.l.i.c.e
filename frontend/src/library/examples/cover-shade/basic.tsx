"use client";
import { useState } from "react";
import { CoverShade } from "@/ui";

export default function Basic() {
  const [p, setP] = useState(60);
  return <div style={{ display: "grid", gap: 8, justifyItems: "center" }}><CoverShade pos={p} moving={false} onCommit={setP} label="Blind position" /><span className="small num">{p}% open</span></div>;
}
