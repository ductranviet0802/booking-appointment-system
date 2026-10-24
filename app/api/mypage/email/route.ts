// spec-screen: P06
// P06 event 14: the NT-06 link of an e-mail change (EMAIL_CHANGE token). The token is applied first, whatever the session
// (14-0); then the session's own P06 with PI061 / PE005 / PE004, a session of another account → its P06 without a
// message, anonymous → P02 with P06 as the target (PI010). No session is revoked.
import type { NextRequest } from "next/server";
import { getSession, loginUrlFor } from "@/lib/auth/context";
import { authRoute, seeOther, setFlash } from "@/lib/auth/route";
import { confirmEmailChange } from "@/lib/patient/mypage";

export function GET(req: NextRequest) {
  return authRoute(req, async () => {
    const r = await confirmEmailChange(req.nextUrl.searchParams.get("token"));
    const s = await getSession();
    if (!s || s.account.role !== "PATIENT") return seeOther(loginUrlFor("/mypage"));
    const res = seeOther("/mypage");
    return r.accountId === s.account.id || r.accountId === null ? setFlash(res, r.code) : res;
  });
}
