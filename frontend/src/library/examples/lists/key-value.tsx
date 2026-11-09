"use client";
import { KeyValue } from "@/ui";

export default function KeyValueExample() {
  return <div style={{ maxWidth: 420 }}><KeyValue rows={[["Address", "http://homeassistant.local:8123"], ["Devices", "39"], ["Last backup", "Today, 2:30 am"]]} /></div>;
}
