// spec-screen: A05
// Event 9 (有効化する): body { id }
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { enableAccount } from "@/lib/admin/staff";

export function POST(req: NextRequest) {
  return adminRoute(req, enableAccount);
}
