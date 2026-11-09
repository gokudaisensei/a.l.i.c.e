"use client";
import { Switch, useHapticsEnabled } from "@/ui";

export default function Setting() {
  const [on, setOn] = useHapticsEnabled();
  return <label className="field"><span>Haptics on this device</span><Switch checked={on} onChange={setOn} label="Haptics on this device" /></label>;
}
