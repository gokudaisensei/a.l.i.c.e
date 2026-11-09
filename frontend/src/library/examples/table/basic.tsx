"use client";
import { Pill, Table } from "@/ui";

export default function Basic() {
  return (
    <Table
      head={["Device", "Room", "State"]}
      rows={[["Floor lamp", "Living room", <Pill key="a" tone="ok">On</Pill>], ["Front door", "Hall", <Pill key="b" tone="warn">Unlocked</Pill>], ["Water heater", "Bathroom", <Pill key="c">Off</Pill>]]}
    />
  );
}
