"use client";
import { useState } from "react";
import { Button, Toast } from "@/ui";

export default function WithUndo() {
  const [show, setShow] = useState(false);
  return (
    <>
      <Button onClick={() => setShow(true)}>Turn on the lamp</Button>
      <Toast placement="inline" show={show} message="Floor lamp on" onUndo={() => setShow(false)} onDismiss={() => setShow(false)} />
    </>
  );
}
