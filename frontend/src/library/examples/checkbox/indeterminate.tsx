"use client";
import { useState } from "react";
import { Checkbox } from "@/ui";

export default function Indeterminate() {
  const [kids, setKids] = useState([true, false]);
  const all = kids.every(Boolean), none = !kids.some(Boolean);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <Checkbox checked={all} indeterminate={!all && !none} onChange={(v) => setKids([v, v])}>All rooms</Checkbox>
      <div style={{ paddingLeft: 28, display: "grid", gap: 4 }}>
        <Checkbox checked={kids[0]} onChange={(v) => setKids([v, kids[1]])}>Kitchen</Checkbox>
        <Checkbox checked={kids[1]} onChange={(v) => setKids([kids[0], v])}>Garden</Checkbox>
      </div>
    </div>
  );
}
