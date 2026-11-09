"use client";
import { useState, useSyncExternalStore } from "react";
import { Button, HAPTICS, haptic, hapticsSupported, type Haptic } from "@/ui";

export default function TryThem() {
  const [last, setLast] = useState("");
  const can = useSyncExternalStore(() => () => {}, () => hapticsSupported(), () => null as boolean | null); // unknown until the browser is asked
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="lib-demo">{(Object.keys(HAPTICS) as Haptic[]).map((k) => <Button key={k} size="sm" onClick={() => { haptic(k); setLast(k); }}>{HAPTICS[k].label}</Button>)}</div>
      <span className="small" role="status">{last ? `Played ${last}.` : can === null ? "" : can ? "Press one." : "This browser cannot vibrate."}</span>
    </div>
  );
}
