// spec-screen: P06
// P06 events 9 / 11: { confirm: false } = the check of 退会する (PE042 or ok); { confirm: true } = はい of PW003 → WITHDRAWN,
// every session revoked, the cookie dropped, PI041 flagged for P01 (reading 6).
import type { NextRequest } from "next/server";
import { answer, setFlash } from "@/lib/auth/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { withdraw } from "@/lib/patient/mypage";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, async (actor, body) => {
    const r = await withdraw(actor, body.confirm === true);
    if (!r.ok || body.confirm !== true) return r;
    const res = setFlash(answer(r), "PI041");
    res.cookies.delete(SESSION_COOKIE);
    return res;
  });
}
