"use client";
import { Table } from "@/ui";

export default function Mono() {
  return <Table mono head={["When", "Who", "What"]} rows={[["02:30:04", "backup", "Backup made"], ["08:12:51", "Gokul", "Front door unlocked"]]} />;
}
