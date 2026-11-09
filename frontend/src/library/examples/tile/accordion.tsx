"use client";
import { useState } from "react";
import { AccordionContext, Grid, Tile, TileHeader } from "@/ui";

export default function Accordion() {
  const [open, setOpen] = useState<Record<string, boolean>>({ "demo:t-a": true });
  return (
    <AccordionContext.Provider value={{ scope: "demo", isOpen: (k, fb) => open[k] ?? fb, toggle: (k, next) => setOpen((o) => ({ ...o, [k]: next })) }}>
      <Grid>
        <Tile id="a" cols={6} colsMobile={12} rows={1}><TileHeader title="Doors" /><p className="small">All locked.</p></Tile>
        <Tile id="b" cols={6} colsMobile={12} rows={1}><TileHeader title="Backups" /><p className="small">Verified today.</p></Tile>
      </Grid>
    </AccordionContext.Provider>
  );
}
