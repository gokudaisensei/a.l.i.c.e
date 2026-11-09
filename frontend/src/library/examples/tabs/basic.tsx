"use client";
import { useState } from "react";
import { Tabs } from "@/ui";

export default function Basic() {
  const [t, setT] = useState("automation");
  return <Tabs value={t} onChange={setT} label="What to build" tabs={[{ id: "automation", label: "Automation" }, { id: "scene", label: "Scene" }, { id: "routine", label: "Routine" }]} />;
}
