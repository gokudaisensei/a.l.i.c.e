"use client";
import { useState } from "react";
import { Icon, IconButton, StepButton } from "@/ui";

export default function IconButtons() {
  const [n, setN] = useState(3);
  const [on, setOn] = useState(false);
  return (
    <div className="lib-demo">
      <IconButton aria-label="Remove this action"><Icon n="trash" /></IconButton>
      <IconButton aria-label="Favourite" active={on} onClick={() => setOn(!on)}><Icon n="star" /></IconButton>
      <StepButton aria-label="Fewer backups" onClick={() => setN(Math.max(1, n - 1))}><Icon n="minus" /></StepButton>
      <b className="num" aria-live="polite">{n}</b>
      <StepButton aria-label="More backups" onClick={() => setN(n + 1)}><Icon n="plus" /></StepButton>
    </div>
  );
}
