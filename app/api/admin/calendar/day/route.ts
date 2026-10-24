// spec-screen: A01
// Event 2 (日付クリック): the booked frames of the date (抽出9). ADMIN and RECEPTION; a date that does not exist → ER-02.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { bookedFrames } from "@/lib/admin/calendar";

export function GET(req: NextRequest) {
  return adminRoute(req, (actor) => bookedFrames(actor.clinicId, req.nextUrl.searchParams.get("date")), { roles: ["ADMIN", "RECEPTION"] });
}
