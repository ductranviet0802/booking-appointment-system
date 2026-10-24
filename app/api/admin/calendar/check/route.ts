// spec-screen: A01
// Event 4 (保存する → ドライラン): the held hours and exceptions are checked again and B2 is dry-run; { n } = frames with bookings that would close.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { checkSave } from "@/lib/admin/calendar";

export function POST(req: NextRequest) {
  return adminRoute(req, (actor, body) => checkSave(actor, body));
}
