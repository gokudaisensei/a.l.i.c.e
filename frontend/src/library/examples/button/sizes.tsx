"use client";
import { Button } from "@/ui";

export default function Sizes() {
  return (
    <div className="lib-demo">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg" variant="primary">Large</Button>
    </div>
  );
}
