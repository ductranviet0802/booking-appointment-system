// P05 token mode: GET ?token= → event 1 (masked address or PE021); POST { token, password, passwordConfirm } → event 3
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, jsonBody, sessionTokenOf, setFlash } from "@/lib/auth/route";
import { checkResetToken, resetPassword } from "@/lib/auth/service";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function GET(req: NextRequest) {
  return authRoute(req, async () => answer(await checkResetToken(req.nextUrl.searchParams.get("token"))));
}

export function POST(req: NextRequest) {
  return authRoute(req, async () => {
    const b = await jsonBody(req);
    const res = answer(await resetPassword({ ...clientOf(req), token: b.token, password: b.password, passwordConfirm: b.passwordConfirm }));
    // every session of the account was revoked; a cookie of it in this browser is dropped too
    if (res.ok && sessionTokenOf(req)) res.cookies.delete(SESSION_COOKIE);
    return res.ok ? setFlash(res, "PI021") : res; // T023: P02 shows PI021 in its box 1-1
  });
}
