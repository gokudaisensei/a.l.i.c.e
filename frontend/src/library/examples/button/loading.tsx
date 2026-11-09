"use client";
import { useState } from "react";
import { Button, Icon } from "@/ui";

export default function Loading() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="lib-demo">
      <Button variant="primary" loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1800); }}>
        <Icon n="check" c="sm" />Save to Home Assistant
      </Button>
    </div>
  );
}
