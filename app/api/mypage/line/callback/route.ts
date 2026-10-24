// spec-screen: P06
// P06 event 5 (T033): LINE Login returns here; PI043 or PE052 on P06 (flash), the state cookie dropped.
import type { NextRequest } from "next/server";
import { getSession, loginUrlFor } from "@/lib/auth/context";
import { authRoute, seeOther, setFlash } from "@/lib/auth/route";
import { LINE_COOKIE, lineCallback } from "@/lib/patient/line";

export function GET(req: NextRequest) {
  return authRoute(req, async () => {
    const s = await getSession();
    if (!s || s.account.role !== "PATIENT") return seeOther(loginUrlFor("/mypage"));
    const p = req.nextUrl.searchParams;
    const code = await lineCallback(s.account.id, { code: p.get("code"), state: p.get("state"), error: p.get("error") }, req.cookies.get(LINE_COOKIE)?.value);
    const res = setFlash(seeOther("/mypage"), code);
    res.cookies.set(LINE_COOKIE, "", { path: "/api/mypage/line", maxAge: 0 });
    return res;
  });
}
