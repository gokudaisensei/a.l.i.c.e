"use client";
import { Icon } from "@/ui";

export default function Filled() {
  return (
    <div className="lib-demo">
      {["home", "grid", "flow", "shield"].map((n) => <span key={n} style={{ display: "inline-flex", gap: 8 }}><Icon n={n} /><Icon n={n} filled /></span>)}
    </div>
  );
}
