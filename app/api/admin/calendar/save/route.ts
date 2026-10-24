// spec-screen: A01
// Event 5 (はい / 影響なし): 更新1 / 2 / 6, then B2 (EVENT) for the affected dates. 409 SE044 when the run failed (the rows stay saved).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { saveCalendar } from "@/lib/admin/calendar";

export function POST(req: NextRequest) {
  return adminRoute(req, (actor, body) => saveCalendar(actor, body));
}
