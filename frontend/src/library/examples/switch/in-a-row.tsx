"use client";
import { useState } from "react";
import { Switch } from "@/ui";

export default function InARow() {
  const [quiet, setQuiet] = useState(true);
  return (
    <div className="row" style={{ maxWidth: 420 }}>
      <div><b>Quiet hours</b><div className="small">Alice holds non-urgent alerts from 10:30 pm</div></div>
      <span /><Switch checked={quiet} onChange={setQuiet} label="Quiet hours" />
    </div>
  );
}
