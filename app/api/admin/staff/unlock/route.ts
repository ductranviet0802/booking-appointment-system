// spec-screen: A05
// Event 10 (ロック解除): body { id }
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { unlockAccount } from "@/lib/admin/staff";

export function POST(req: NextRequest) {
  return adminRoute(req, unlockAccount);
}
