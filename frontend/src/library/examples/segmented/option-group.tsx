"use client";
import { useState } from "react";
import { Icon, OptionButton, OptionGroup } from "@/ui";

export default function Options() {
  const [on, setOn] = useState<string[]>(["kitchen"]);
  const toggle = (k: string) => setOn((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <OptionGroup>
      {[["kitchen", "Kitchen", "bulb"], ["garden", "Garden", "sun"], ["hall", "Hall", "door"]].map(([k, l, i]) => (
        <OptionButton key={k} pressed={on.includes(k)} icon={<Icon n={i} c="sm" />} onClick={() => toggle(k)}>{l}</OptionButton>
      ))}
    </OptionGroup>
  );
}
