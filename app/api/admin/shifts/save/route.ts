// spec-screen: A02
// Event 6 (はい / 影響なし): 更新1 / 2 / 4 in one transaction, then B2 (EVENT) per clinic. 409 SE044 when a run failed (the rows stay saved). ADMIN only.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { saveShifts } from "@/lib/admin/shifts";

export function POST(req: NextRequest) {
  return adminRoute(req, (actor, body) => saveShifts(actor, body));
}
