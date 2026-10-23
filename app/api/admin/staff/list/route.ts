// spec-screen: A05
// Events 1 / 13 and the reload after a write: the accounts in the viewer's scope (抽出2, 4, 5). The filters run in the browser.
import type { NextRequest } from "next/server";
import { adminRoute, done } from "@/lib/admin/common";
import { loadStaff } from "@/lib/admin/staff";

export function GET(req: NextRequest) {
  return adminRoute(req, async (actor) => done({ lists: await loadStaff(actor) }));
}
