"use client";
import { Field, FieldRow, Input } from "@/ui";

export default function Sizes() {
  return (
    <FieldRow>
      <Field label="Port"><Input className="inp--sm" defaultValue="8123" inputMode="numeric" /></Field>
      <Field label="Code"><Input className="inp--code inp--mono" defaultValue="K7QX-92DA" /></Field>
      <Field label="Address"><Input className="inp--fill" defaultValue="http://homeassistant.local:8123" /></Field>
    </FieldRow>
  );
}
