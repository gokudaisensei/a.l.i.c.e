"use client";
import { useState } from "react";
import { BottomSheet, Button, Icon, IconButton, Slider } from "@/ui";

export default function Basic() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(60);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Open the lamp’s controls</Button>
      <BottomSheet open={open} onOpenChange={setOpen} label="Floor lamp controls">
        <div className="th"><div><h3 className="tt" style={{ fontSize: "1.375rem" }}>Floor lamp</h3><small>Living room</small></div><IconButton aria-label="Close" onClick={() => setOpen(false)}><Icon n="x" /></IconButton></div>
        <div className="sbig">{v}%</div>
        <Slider size="xl" value={v} onChange={setV} label="Brightness" />
      </BottomSheet>
    </>
  );
}
