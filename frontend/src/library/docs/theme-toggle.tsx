"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Segmented } from "@/ui";

/** Light, dark or the system's. The examples' frames follow it (they share the same storage). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false); // false on the server, true in the browser
  return <Segmented value={mounted ? theme ?? "system" : "system"} label="Theme" items={[["light", "Light"], ["dark", "Dark"], ["system", "Auto"]]} onChange={setTheme} />;
}
