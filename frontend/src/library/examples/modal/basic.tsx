"use client";
import { useState } from "react";
import { Button, Modal } from "@/ui";

export default function Basic() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open the dialog</Button>
      <Modal open={open} onOpenChange={setOpen} label="Remove this automation" placement="center">
        <div style={{ padding: 24, display: "grid", gap: 14 }}>
          <h3 className="tt" style={{ fontSize: "1.375rem" }}>Remove “Goodnight”?</h3>
          <p className="muted">It stops running. You can make it again any time.</p>
          <div className="btns"><Button variant="danger" onClick={() => setOpen(false)}>Remove</Button><Button onClick={() => setOpen(false)}>Keep it</Button></div>
        </div>
      </Modal>
    </>
  );
}
