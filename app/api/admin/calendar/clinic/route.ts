// spec-screen: A01
// Event 8 (保存する（クリニック情報）): the session clinic's profile; no B2.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { saveClinic } from "@/lib/admin/calendar";

export function POST(req: NextRequest) {
  return adminRoute(req, (actor, body) => saveClinic(actor, body));
}
