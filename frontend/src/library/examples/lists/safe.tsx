"use client";
import { Safe } from "@/ui";

export default function SafeExample() {
  return <div style={{ maxWidth: 420 }}><Safe items={["Your passkey never leaves your device", "Backups are encrypted", { text: "Alice never shares locks with voice assistants", muted: true }]} /></div>;
}
