"use client";

// spec-screen: ER-02
// Error boundary inside the patient frame: CF-01 / CF-02 stay around the error block.
import { Er02 } from "@/components/frame/Er02";

export default function PatientError() {
  return <Er02 />;
}
