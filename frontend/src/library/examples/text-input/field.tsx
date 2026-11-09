"use client";
import { useState } from "react";
import { Field, Input } from "@/ui";

export default function FieldExample() {
  const [name, setName] = useState("");
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 420 }}>
      <Field label="Name"><Input className="inp--fill" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this automation" /></Field>
    </div>
  );
}
