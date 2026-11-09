"use client";
import { useState } from "react";
import { Field, TimeField } from "@/ui";

export default function Basic() {
  const [t, setT] = useState("02:30");
  return <Field label="Backup time"><TimeField label="Backup time" value={t} onChange={setT} /></Field>;
}
