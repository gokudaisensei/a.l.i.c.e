"use client";
import { useState } from "react";
import { Segmented } from "@/ui";

export default function Basic() {
  const [v, setV] = useState("home");
  return <Segmented value={v} onChange={setV} label="Household mode" items={[["home", "Home"], ["away", "Away"], ["night", "Night"]]} />;
}
