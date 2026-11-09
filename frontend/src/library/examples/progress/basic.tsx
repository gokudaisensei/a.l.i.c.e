"use client";
import { useState } from "react";
import { Bar, Button, Progress } from "@/ui";

export default function Basic() {
  const [p, setP] = useState(35);
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 380 }}>
      <Bar percent={p} label="Backup progress" />
      <Progress value={p * 3} max={300} label="Photos copied" />
      <div className="btns"><Button size="sm" onClick={() => setP(Math.min(100, p + 15))}>More</Button><Button size="sm" onClick={() => setP(Math.max(0, p - 15))}>Less</Button></div>
    </div>
  );
}
