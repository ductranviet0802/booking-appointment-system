// spec-screen: A03
// Events 6 / 11 (無効化する / 有効化する): body { kind, id, active }
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { setActive } from "@/lib/admin/masters";

export function POST(req: NextRequest) {
  return adminRoute(req, setActive);
}
