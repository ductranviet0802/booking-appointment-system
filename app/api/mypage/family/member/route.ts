// spec-screen: P07
// P07 event 3 「編集」: GET ?id=<patientId> → the member and its 診察券 rows; not an own member → 404 PE091 (ER-01).
import type { NextRequest } from "next/server";
import { loadMember } from "@/lib/patient/family";
import { patientRoute } from "@/lib/patient/route";

export function GET(req: NextRequest) {
  return patientRoute(req, (a) => loadMember(a, req.nextUrl.searchParams.get("id")));
}
