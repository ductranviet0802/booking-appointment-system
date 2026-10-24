// P03 events 6 / 7: the NT-06 link /register?token=… is rewritten here by proxy.ts.
// Valid → logged in, 303 to P06 or the return target with the flash PI002; else 303 to the P03 再送 state.
import type { NextRequest } from "next/server";
import { applyLogin, authRoute, clientOf, guardIdOf, seeOther, sessionTokenOf, setFlash } from "@/lib/auth/route";
import { verifyEmail } from "@/lib/auth/service";

export function GET(req: NextRequest) {
  return authRoute(req, async () => {
    const r = await verifyEmail({
      ...clientOf(req), token: req.nextUrl.searchParams.get("token"), currentSessionToken: sessionTokenOf(req), guardId: guardIdOf(req),
    });
    if (!r.ok) return seeOther(`/register?resend=${r.code}`);
    return setFlash(applyLogin(seeOther(String(r.body.destination)), r), "PI002");
  });
}
