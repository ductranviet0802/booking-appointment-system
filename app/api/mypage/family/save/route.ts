// spec-screen: P07
// P07 event 6 保存する: add (no patientId) or edit (patientId of an own member, requireOwnPatient) with its 診察券.
import type { NextRequest } from "next/server";
import { saveMember } from "@/lib/patient/family";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, saveMember);
}
