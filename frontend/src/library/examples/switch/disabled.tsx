"use client";
import { Switch } from "@/ui";

export default function Disabled() {
  return <div className="lib-demo"><Switch checked disabled onChange={() => {}} label="Always on" /><Switch checked={false} disabled onChange={() => {}} label="Not available" /></div>;
}
