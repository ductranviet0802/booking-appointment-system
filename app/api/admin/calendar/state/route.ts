// spec-screen: A01
// Events 1 / 10 and the refresh after events 5 / 6: hours, the month, the holiday list, the last runs, the 要調整 count.
// ADMIN and RECEPTION (DOCTOR → 403 SE091).
import type { NextRequest } from "next/server";
import { adminRoute, bad, done } from "@/lib/admin/common";
import { loadState, ymOk } from "@/lib/admin/calendar";
import { todayJst } from "@/lib/datetime";

export function GET(req: NextRequest) {
  return adminRoute(req, async (actor) => {
    const ym = req.nextUrl.searchParams.get("ym") ?? todayJst(actor.now).slice(0, 7);
    if (!ymOk(ym)) return bad();
    return done({ state: await loadState(actor.clinicId, ym, actor.now) });
  }, { roles: ["ADMIN", "RECEPTION"] });
}
