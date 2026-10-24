// spec-screen: P06
// P06 event 7 保存する: profile (SELF patient of the session), channel / SMS consent, 診察券, e-mail change. Any patient id in
// the body is ignored (reading 3).
import type { NextRequest } from "next/server";
import { saveMypage } from "@/lib/patient/mypage";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, saveMypage);
}
