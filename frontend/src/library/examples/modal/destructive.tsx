"use client";
import { useState } from "react";
import { Button, ConfirmDialog } from "@/ui";

export default function Destructive() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>Erase the household</Button>
      <ConfirmDialog open={open} destructive title="Erase everything?" description="This removes your household, backups and automations. It cannot be undone." confirmLabel="Erase" state="idle"
        onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </>
  );
}
