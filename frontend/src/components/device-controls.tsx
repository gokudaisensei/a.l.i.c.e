"use client";
import { Button, Icon, Slider } from "@/ui";
import { A } from "@/lib/store";
import type { Dev } from "@/lib/data";

/** Brightness slider bound to a dimmable device. */
export function DevSlider({ d, size }: { d: Dev; size?: "md" | "xl" }) {
  return <Slider value={d.v!} size={size} label={`${d.n} brightness`} onChange={(v) => A.slide(d.id, v)} />;
}

/** Lock or unlock button. Unlocking asks for a passkey first. */
export function LockButton({ d }: { d: Dev }) {
  return (
    <Button size="sm" onClick={() => (d.locked ? A.unlock(d.id) : A.lock(d.id))}>
      <Icon n={d.locked ? "unlock" : "lock"} c="sm" />{d.locked ? "Unlock" : "Lock"}
    </Button>
  );
}
