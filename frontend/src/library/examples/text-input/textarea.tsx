"use client";
import { Field, Textarea } from "@/ui";

export default function TextareaExample() {
  return <Field label="Note"><Textarea className="inp--fill" rows={3} placeholder="Anything Alice should know" /></Field>;
}
