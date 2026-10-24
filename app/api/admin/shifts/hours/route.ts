// spec-screen: A02
// 抽出5 for the hold check of an exception (event 10): the open bands of a date at the session clinic. ADMIN only (the form is ADMIN's).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { readHours } from "@/lib/admin/shifts";

export function GET(req: NextRequest) {
  return adminRoute(req, (actor) => readHours(actor, req.nextUrl.searchParams.get("date")));
}
