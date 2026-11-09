"use client";
import { useState } from "react";
import { Segmented } from "@/ui";

export default function FullWidth() {
  const [speed, setSpeed] = useState(2);
  return <Segmented className="seg-full" value={speed} onChange={setSpeed} label="Fan speed" items={[[1, "Speed 1"], [2, "Speed 2"], [3, "Speed 3"]]} />;
}
