"use client";
import { useState } from "react";
import { Checkbox } from "@/ui";

export default function Bare() {
  const [on, setOn] = useState(false);
  return <Checkbox checked={on} onChange={setOn} label="Select Front door" />;
}
