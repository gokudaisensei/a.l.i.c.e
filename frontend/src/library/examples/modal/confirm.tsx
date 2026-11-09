"use client";
import { useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/ui";

export default function Confirm() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "go" | "ok">("idle");
  const ref = useRef<HTMLButtonElement>(null);
  const run = () => { setState("go"); setTimeout(() => { setState("ok"); setTimeout(() => { setOpen(false); setState("idle"); }, 700); }, 1000); };
  return (
    <>
      <Button variant="sage" onClick={() => setOpen(true)}>Unlock the front door</Button>
      <ConfirmDialog open={open} title="Unlock the front door?" description="Unlocking asks for your passkey, so a stray tap can't open the house." state={state} onConfirm={run} onCancel={() => { setOpen(false); setState("idle"); }} confirmRef={ref} />
    </>
  );
}
