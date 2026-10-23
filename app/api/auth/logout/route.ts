// _common events 4 / 11 (更新3): revoke the session, clear the cookie; destination P01 (patients) / P02 (staff)
import type { NextRequest } from "next/server";
import { answer, authRoute, sessionTokenOf } from "@/lib/auth/route";
import { logout } from "@/lib/auth/service";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function POST(req: NextRequest) {
  return authRoute(req, async () => {
    const res = answer(await logout(sessionTokenOf(req)));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  });
}
