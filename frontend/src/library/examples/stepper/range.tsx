"use client";
import { useState } from "react";
import { Stepper } from "@/ui";

export default function Range() {
  const [t, setT] = useState(21);
  return <Stepper value={t} onChange={setT} min={16} max={30} step={0.5} unit="°" label="Target temperature" />;
}
