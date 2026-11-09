"use client";
import { useState } from "react";
import { Dial } from "@/ui";

export default function Fan() {
  const [p, setP] = useState(66);
  return (
    <Dial value={p} min={0} max={100} step={100 / 3} unit="%" label="Fan speed" onCommit={(v) => setP(Math.round(v))}>
      {(v) => <><b className="num">{Math.round(v)}%</b><small>{v <= 0 ? "off" : "speed"}</small></>}
    </Dial>
  );
}
