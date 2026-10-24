// spec-screen: A02
// Event 5 (保存の確認): server re-check of the held rows and the B2 dry run → { n } frames with bookings that would close. ADMIN only.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { checkSave } from "@/lib/admin/shifts";

export function POST(req: NextRequest) {
  return adminRoute(req, (actor, body) => checkSave(actor, body));
}
