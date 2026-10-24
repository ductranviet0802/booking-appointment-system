// spec-screen: A02
// Events 1 / 12 and the refresh after a save: the week overview (抽出7) and the 要調整 count (抽出8).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { readWeek } from "@/lib/admin/shifts";

export function GET(req: NextRequest) {
  return adminRoute(req, (actor) => readWeek(actor, req.nextUrl.searchParams.get("start")), { roles: ["ADMIN", "RECEPTION", "DOCTOR"] });
}
