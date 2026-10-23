// spec-screen: A05
// Event 8 (無効化する, after SW070): body { id }; the own account → 409 SE071
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { disableAccount } from "@/lib/admin/staff";

export function POST(req: NextRequest) {
  return adminRoute(req, disableAccount);
}
