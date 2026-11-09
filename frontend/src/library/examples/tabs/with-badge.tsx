"use client";
import { useState } from "react";
import { Tabs } from "@/ui";

export default function WithBadge() {
  const [t, setT] = useState("home");
  return <Tabs value={t} onChange={setT} label="Sections" tabs={[{ id: "home", label: "Home" }, { id: "backups", label: "Backups", badge: true }, { id: "support", label: "Support" }]} />;
}
