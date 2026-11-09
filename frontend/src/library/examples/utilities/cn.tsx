"use client";
import { cn } from "@/ui";

export default function Cn() {
  const on = true, warn = false;
  return <code>{cn("btn", on && "is-on", warn && "warn", ["a", "b"], { "has-x": true, hidden: false })}</code>;
}
