"use client";
import { Steps } from "@/ui";

export default function StepsExample() {
  return <Steps steps={["Make the backup", "Encrypt it", "Test the restore", "Done"]} current={2} />;
}
