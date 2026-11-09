"use client";
import { Pill } from "@/ui";

export default function PillExample() {
  return (
    <div className="lib-demo">
      <Pill>Neutral</Pill>
      <Pill tone="ok" icon="check">Verified</Pill>
      <Pill tone="warn" icon="alert">Unlocked</Pill>
      <Pill tone="info" icon="moon">Quiet hours</Pill>
    </div>
  );
}
