"use client";
import { useState } from "react";
import { Stepper } from "@/ui";

export default function Basic() {
  const [n, setN] = useState(14);
  return <Stepper value={n} onChange={setN} min={1} max={60} unit="backups" label="Backups to keep" />;
}
