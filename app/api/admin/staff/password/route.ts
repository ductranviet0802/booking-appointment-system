// spec-screen: A05
// Event 7 (パスワード発行): body { id }; the answer carries the new initial password, once
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { issuePassword } from "@/lib/admin/staff";

export function POST(req: NextRequest) {
  return adminRoute(req, issuePassword);
}
