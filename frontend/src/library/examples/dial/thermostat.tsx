"use client";
import { useState } from "react";
import { Dial } from "@/ui";

export default function Thermostat() {
  const [t, setT] = useState(24);
  return (
    <Dial value={t} min={16} max={30} step={0.5} unit="°" marker={22.5} color="rgb(90 160 255)" label="Target temperature" resetValue={22} onCommit={setT}>
      {(v) => <><b className="num">{v % 1 ? v.toFixed(1) : v}°</b><small>now 22.5°</small></>}
    </Dial>
  );
}
