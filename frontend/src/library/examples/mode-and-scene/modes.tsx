"use client";
import { useState } from "react";
import { ModeButton } from "@/ui";

export default function Modes() {
  const [m, setM] = useState("Home");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,8rem),1fr))", gap: 8 }}>
      {[["Home", "home", "Everyone is in"], ["Away", "exit", "Doors locked"], ["Night", "moon", "Quiet hours"]].map(([k, i, d]) => (
        <ModeButton key={k} icon={i} label={k} description={d} pressed={m === k} onClick={() => setM(k)} />
      ))}
    </div>
  );
}
