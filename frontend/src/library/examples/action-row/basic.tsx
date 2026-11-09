"use client";
import { useState } from "react";
import { ActionRow, Select, Stepper } from "@/ui";

export default function Basic() {
  const [rows, setRows] = useState(["on", "dim"]);
  const [dev, setDev] = useState("lamp");
  const [n, setN] = useState(40);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.includes("on") ? <ActionRow icon="bulb" verb="Turn on" onRemove={() => setRows(rows.filter((r) => r !== "on"))}><Select value={dev} onChange={setDev} label="Device" options={[["lamp", "Floor lamp"], ["kitchen", "Kitchen lights"]]} /></ActionRow> : null}
      {rows.includes("dim") ? <ActionRow icon="sun" verb="Dim" onRemove={() => setRows(rows.filter((r) => r !== "dim"))}><Stepper value={n} onChange={setN} min={5} max={100} step={5} unit="%" label="Brightness" /></ActionRow> : null}
    </div>
  );
}
