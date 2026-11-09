"use client";
import { Icon, IconButton, Tooltip } from "@/ui";

export default function Basic() {
  return (
    <div className="lib-demo">
      <Tooltip label="Rename or hide"><IconButton aria-label="Rename or hide"><Icon n="note" /></IconButton></Tooltip>
      <Tooltip label="Remove this action" side="bottom"><IconButton aria-label="Remove this action"><Icon n="trash" /></IconButton></Tooltip>
    </div>
  );
}
