"use client";
import { useState } from "react";
import { WhiteStrip } from "@/ui";

export default function White() {
  const [k, setK] = useState(3000);
  return <div style={{ paddingTop: 22, maxWidth: 420 }}><WhiteStrip kelvin={k} min={2000} max={6500} onCommit={setK} label="White temperature" /></div>;
}
