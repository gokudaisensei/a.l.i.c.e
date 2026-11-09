"use client";
import { useState } from "react";
import { LockTile } from "@/ui";

export default function Basic() {
  const [locks, setLocks] = useState([true, false]);
  const names = ["Front door", "Back door"];
  return (
    <div className="deep" style={{ background: "var(--deep)", color: "var(--deep-ink)", padding: 12, borderRadius: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {names.map((n, i) => (
        <LockTile key={n} icon={locks[i] ? "lock" : "unlock"} name={n} locked={locks[i]} status={locks[i] ? "Locked" : "Open · tap to lock"}
          hint={locks[i] ? "Tap to unlock." : "Tap to lock."} onClick={() => setLocks(locks.map((l, j) => (j === i ? !l : l)))} />
      ))}
    </div>
  );
}
