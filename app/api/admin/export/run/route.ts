// spec-screen: A06
// 出力する (event 3): RECEPTION and ADMIN of the session clinic; body { kind: PATIENTS|BOOKINGS|BOTH, from, to } (YYYY/MM/DD).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { startExport } from "@/lib/admin/export";

export function POST(req: NextRequest) {
  return adminRoute(req, startExport, { roles: ["RECEPTION", "ADMIN"] });
}
