"use client";

// spec-screen: ER-02
// Error boundary inside the patient frame: CF-01 stays, CF-02 is hidden around the error block (F-04, .page:has(.eb) .ft).
import { Er02 } from "@/components/frame/Er02";

export default function PatientError() {
  return <Er02 inFrame />;
}
