"use client";
import { useState } from "react";
import { Field, Select } from "@/ui";

export default function WithLabel() {
  const [v, setV] = useState("");
  return (
    <Field label="Room">
      <Select value={v} onChange={setV} placeholder="Choose a room" options={[["kitchen", "Kitchen"], ["hall", "Hall"], ["garden", "Garden"], ["bedroom", "Bedroom"]]} />
    </Field>
  );
}
