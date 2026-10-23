// spec-screen: A05
// Events 5 / 6 (保存する): no id = create (the answer carries the initial password, once), id = edit
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { saveStaff } from "@/lib/admin/staff";

export function POST(req: NextRequest) {
  return adminRoute(req, saveStaff);
}
