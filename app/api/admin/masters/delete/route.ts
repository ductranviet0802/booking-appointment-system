// spec-screen: A03
// Events 7 / 8 (削除する): body { kind, id, confirmed }; confirmed false only checks (SE050 or { deletable: true })
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { deleteRecord } from "@/lib/admin/masters";

export function POST(req: NextRequest) {
  return adminRoute(req, deleteRecord);
}
