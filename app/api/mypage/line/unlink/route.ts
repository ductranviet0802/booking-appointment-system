// spec-screen: P06
// P06 event 13 LINE連携を解除: line_user_id / line_friend null, channel back to MAIL; PI058.
import type { NextRequest } from "next/server";
import { unlinkLine } from "@/lib/patient/mypage";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, async (a) => {
    await unlinkLine(a.accountId);
    return { ok: true, body: { code: "PI058" } };
  });
}
