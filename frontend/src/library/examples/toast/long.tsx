"use client";
import { Toast } from "@/ui";

export default function Long() {
  return (
    <Toast placement="inline" show tone="warn" title="Home Assistant refused it" duration={1_000_000} onDismiss={() => {}}
      message="Home Assistant did not accept turning on the Kitchen Door lock because it needs a fresh passkey confirmation, and the confirmation window of five minutes has already passed since you last touched your phone. Confirm with your passkey, then try again." />
  );
}
