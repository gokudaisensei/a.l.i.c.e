"use client";
import { useState } from "react";
import { Icon } from "@/ui";

/** Copies text to the clipboard and says so. */
export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="lib-copy" aria-label={done ? "Copied" : label} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch {} }}>
      <Icon n={done ? "check" : "copy"} c="sm" /><span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}
