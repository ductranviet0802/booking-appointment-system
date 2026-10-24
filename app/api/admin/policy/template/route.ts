// spec-screen: A04
// GET: event 2 (抽出1, the combination's stored text). POST: events 6 / 7 (template save; SMS over 70 → { confirm: "SW061" }).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { saveTemplate, template } from "@/lib/admin/policy";

export function GET(req: NextRequest) {
  return adminRoute(req, (actor) => template(actor, Object.fromEntries(req.nextUrl.searchParams)));
}

export function POST(req: NextRequest) {
  return adminRoute(req, saveTemplate);
}
