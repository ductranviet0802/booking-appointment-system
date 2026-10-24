// spec-screen: A02
// Event 2 (医師選択): 抽出3-6 of one doctor. ADMIN / RECEPTION any listed doctor, DOCTOR self only (another doctor → 403 SE091).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { readDetail } from "@/lib/admin/shifts";

export function GET(req: NextRequest) {
  return adminRoute(req, (actor) => readDetail(actor, req.nextUrl.searchParams.get("doctorId")), { roles: ["ADMIN", "RECEPTION", "DOCTOR"] });
}
