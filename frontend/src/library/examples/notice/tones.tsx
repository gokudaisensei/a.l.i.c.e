"use client";
import { Notice } from "@/ui";

export default function Tones() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Notice>Alice reads who is home from each person’s phone in Home Assistant.</Notice>
      <Notice tone="ok">Backup made and its restore test passed.</Notice>
      <Notice tone="warn">Home Assistant isn’t reachable. Check that it is on and on the same network.</Notice>
    </div>
  );
}
