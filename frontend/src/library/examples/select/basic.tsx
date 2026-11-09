"use client";
import { useState } from "react";
import { Select } from "@/ui";

export default function Basic() {
  const [v, setV] = useState("weekdays");
  return <Select value={v} onChange={setV} label="Days" options={[["any", "Any day"], ["weekdays", "Weekdays"], ["weekends", "Weekends"]]} />;
}
