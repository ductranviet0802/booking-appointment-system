"use client";

// spec-screen: ER-02
// Error boundary inside the staff frame: CF-03 stays above the error block (SE090).
import { Er02 } from "@/components/frame/Er02";

export default function StaffError() {
  return <Er02 />;
}
