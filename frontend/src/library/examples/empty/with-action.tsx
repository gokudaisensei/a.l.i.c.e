"use client";
import { Button, Empty } from "@/ui";

export default function WithAction() {
  return <Empty action={<Button variant="primary" size="sm">Make a scene</Button>}>No scenes yet. A scene sets several things at once.</Empty>;
}
