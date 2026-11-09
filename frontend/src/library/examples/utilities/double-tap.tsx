"use client";
import { useState } from "react";
import { haptic, useDoubleTap } from "@/ui";

export default function DoubleTap() {
  const [on, setOn] = useState(false);
  const tap = useDoubleTap(() => { haptic("medium"); setOn((v) => !v); });
  return <div {...tap} role="presentation" style={{ padding: 28, borderRadius: 18, textAlign: "center", background: on ? "var(--glow-soft)" : "var(--tile2)", color: on ? "var(--glow-ink)" : "var(--ink2)", touchAction: "manipulation", userSelect: "none" }}>{on ? "On: double-tap to turn off" : "Double-tap me"}</div>;
}
