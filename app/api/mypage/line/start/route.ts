// spec-screen: P06
// P06 event 5 / X2-L: a random state and OIDC nonce in an HttpOnly cookie, then the LINE Login authorize URL (reading 5).
import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, randomToken } from "@/lib/adapters/x2-line-login";
import { getSession, loginUrlFor } from "@/lib/auth/context";
import { authRoute, seeOther } from "@/lib/auth/route";
import { LINE_COOKIE, lineRedirectUri } from "@/lib/patient/line";

export function GET(req: NextRequest) {
  return authRoute(req, async () => {
    const s = await getSession();
    if (!s || s.account.role !== "PATIENT") return seeOther(loginUrlFor("/mypage"));
    const state = randomToken();
    const nonce = randomToken();
    const res = NextResponse.redirect(authorizeUrl({ state, nonce, redirectUri: lineRedirectUri() }), 303);
    res.cookies.set(LINE_COOKIE, `${state}.${nonce}`, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/mypage/line", maxAge: 600,
    });
    return res;
  });
}
