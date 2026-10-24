// spec-screen: P07
// P07 events 7 / 9: { patientId, confirm: false } = the check of 削除 (PE043 or ok); { patientId, confirm: true } = はい of
// PW004 → deleted (never booked) or detached (booked before), PI047. Not an own member → 404 PE091 (ER-01).
import type { NextRequest } from "next/server";
import { checkDelete, deleteMember } from "@/lib/patient/family";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, (a, body) => (body.confirm === true ? deleteMember(a, body.patientId) : checkDelete(a, body.patientId)));
}
