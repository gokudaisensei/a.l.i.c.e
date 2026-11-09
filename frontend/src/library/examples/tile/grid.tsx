"use client";
import { Grid, Tile, TileHeader } from "@/ui";

export default function GridExample() {
  return (
    <Grid>
      <Tile id="a" cols={6} colsTablet={6} colsMobile={12} rows={1} tone="sage"><TileHeader eyebrow="Now" title="Household mode" /><p className="small">Everyone is in.</p></Tile>
      <Tile id="b" cols={6} colsTablet={6} colsMobile={12} rows={1}><TileHeader eyebrow="Energy" title="0.10 kW" /><p className="small">Today 32.3 kWh</p></Tile>
    </Grid>
  );
}
