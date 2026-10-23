// spec-screen: A05
// Event 2 (行クリック): one account for the form (抽出3); unknown id → SE090, outside the viewer's scope → 403 SE091.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { loadStaffDetail } from "@/lib/admin/staff";

export function GET(req: NextRequest) {
  return adminRoute(req, (actor) => loadStaffDetail(actor, req.nextUrl.searchParams.get("id") ?? ""));
}
