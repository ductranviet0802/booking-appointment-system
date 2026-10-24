// spec-screen: A04
// Event 8 (保存する, policy tab): checks, SW062 round trip ({ confirm: "SW062" }), save + audit, B2 (EVENT) on a window change.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { savePolicy } from "@/lib/admin/policy";

export function POST(req: NextRequest) {
  return adminRoute(req, savePolicy);
}
