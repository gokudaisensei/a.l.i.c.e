"use client";
import { useState } from "react";
import { haptic, useSwipeSelect } from "@/ui";

const ROOMS = ["Kitchen", "Hall", "Garden", "Bedroom"];

export default function SwipeSelect() {
  const [i, setI] = useState(0);
  const swipe = useSwipeSelect({ index: i, onIndex: (n) => { haptic("select"); setI(n); }, itemSelector: "button" });
  return (
    <div {...swipe} style={{ display: "flex", gap: 8, flexWrap: "wrap", touchAction: "pan-y" }}>
      {ROOMS.map((r, n) => <button key={r} type="button" className="rchip" aria-pressed={i === n} onClick={() => { haptic("select"); setI(n); }}>{r}</button>)}
    </div>
  );
}
