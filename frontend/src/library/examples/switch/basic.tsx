"use client";
import { useState } from "react";
import { Switch } from "@/ui";

export default function Basic() {
  const [on, setOn] = useState(true);
  return <div className="lib-demo"><Switch checked={on} onChange={setOn} label="Push notifications" /><span>{on ? "On" : "Off"}</span></div>;
}
