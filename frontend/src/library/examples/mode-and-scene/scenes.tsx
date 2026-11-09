"use client";
import { SceneCard } from "@/ui";

export default function Scenes() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,10rem),1fr))", gap: 10 }}>
      <SceneCard icon="play" name="Movie night" description="Ceiling off, lamp 15%" tag="Suggested now" suggested />
      <SceneCard icon="sun" name="Good morning" description="Kitchen lights up" tag="Routine" />
    </div>
  );
}
