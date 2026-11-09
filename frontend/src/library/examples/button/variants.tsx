"use client";
import { Button } from "@/ui";

export default function Variants() {
  return (
    <div className="lib-demo">
      <Button>Default</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="sage">Sage</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
      <Button disabled>Disabled</Button>
    </div>
  );
}
