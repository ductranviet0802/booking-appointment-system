// F9-03 login guard (T067 / T068): hold the target in an anonymous server-side record, then 303 to P02.
// Used by loginUrlFor() of lib/auth/context.ts; only internal paths are kept (no open redirect).
import type { NextRequest } from "next/server";
import { internalPath } from "@/lib/auth/access";
import { createGuard, guardCookieOptions } from "@/lib/auth/guard-store";
import { authRoute, seeOther } from "@/lib/auth/route";
import { GUARD_COOKIE } from "@/lib/auth/session";

export function GET(req: NextRequest) {
  return authRoute(req, async () => {
    const res = seeOther("/login");
    const target = internalPath(req.nextUrl.searchParams.get("next"));
    if (target) res.cookies.set(GUARD_COOKIE, createGuard(target), guardCookieOptions());
    return res;
  });
}
