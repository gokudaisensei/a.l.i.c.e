"use client";
import { Button, Notice } from "@/ui";

export default function WithAction() {
  return <Notice tone="warn" action={<Button size="sm">Try again</Button>}>The backup didn’t finish.</Notice>;
}
