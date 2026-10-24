// _common events 4 / 11 (更新3): revoke the session, clear the cookie; destination P01 (patients) / P02 (staff).
// Staff: P02 shows PI011 in its guidance box (P02 item 1-1, T089), carried by the flash cookie.
import type { NextRequest } from "next/server";
import { answer, authRoute, sessionTokenOf, setFlash } from "@/lib/auth/route";
import { logout } from "@/lib/auth/service";
import { SESSION_COOKIE } from "@/lib/auth/session";

export function POST(req: NextRequest) {
  return authRoute(req, async () => {
    const r = await logout(sessionTokenOf(req));
    const res = answer(r);
    res.cookies.delete(SESSION_COOKIE);
    return r.body.destination === "/login" ? setFlash(res, "PI011") : res;
  });
}
