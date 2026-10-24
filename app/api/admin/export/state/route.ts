// spec-screen: A06
// The list and status lines again (after 出力する / ダウンロード); runs 更新1 like the first open.
import type { NextRequest } from "next/server";
import { adminRoute, done } from "@/lib/admin/common";
import { loadExportState } from "@/lib/admin/export";

export function GET(req: NextRequest) {
  return adminRoute(req, async (a) => done({ state: await loadExportState(a.clinicId, a.role, a.now) }), { roles: ["RECEPTION", "ADMIN"] });
}
