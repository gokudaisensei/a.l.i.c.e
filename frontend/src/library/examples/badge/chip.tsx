"use client";
import { Chip } from "@/ui";

export default function ChipExample() {
  return (
    <div className="lib-demo" data-tod="day" style={{ background: "linear-gradient(155deg,var(--hero-a),var(--hero-b))", padding: 16, borderRadius: 18 }}>
      <Chip icon="camera">2 cameras online</Chip>
      <Chip icon="alert" warn onClick={() => {}}>Backup not verified yet</Chip>
      <Chip icon="door" warn>Front hallway ceiling light above the stairs and coat rack is open</Chip>
    </div>
  );
}
