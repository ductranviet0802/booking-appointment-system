// spec-screen: A04
// Event 4 (プレビュー): renders the typed subject / body with the sample data; nothing is written.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { preview } from "@/lib/admin/policy";

export function POST(req: NextRequest) {
  return adminRoute(req, preview);
}
