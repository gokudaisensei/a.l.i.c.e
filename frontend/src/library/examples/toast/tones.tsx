"use client";
import { Toast } from "@/ui";

export default function Tones() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Toast placement="inline" show message="Floor lamp on" duration={1_000_000} onDismiss={() => {}} />
      <Toast placement="inline" show tone="ok" message="Saved. Alice is adding it to Home Assistant" duration={1_000_000} onDismiss={() => {}} />
      <Toast placement="inline" show tone="warn" title="The garage door didn't respond" message="It may be out of range. Try again, or check it is powered." duration={1_000_000} onDismiss={() => {}} />
    </div>
  );
}
