"use client";
import { useState } from "react";
import { Checkbox } from "@/ui";

export default function Row() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <Checkbox checked={a} onChange={setA}>Let Alice add scenes and automations</Checkbox>
      <Checkbox checked={b} onChange={setB}>Keep the last 14 backups</Checkbox>
    </div>
  );
}
