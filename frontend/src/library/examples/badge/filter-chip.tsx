"use client";
import { useState } from "react";
import { FilterChip } from "@/ui";

export default function FilterChipExample() {
  const [room, setRoom] = useState("all");
  return (
    <div className="lib-demo">
      {[["all", "All", 39], ["kitchen", "Kitchen", 4], ["hall", "Hall", 2]].map(([k, l, n]) => (
        <FilterChip key={k as string} pressed={room === k} count={n as number} onClick={() => setRoom(k as string)}>{l}</FilterChip>
      ))}
    </div>
  );
}
