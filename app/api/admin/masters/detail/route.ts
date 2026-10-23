// spec-screen: A03
// Event 2 (行クリック): the record for the form, re-read from the database; an unknown id → ER-02 (SE090). ADMIN and RECEPTION.
import type { NextRequest } from "next/server";
import { adminRoute, bad, done } from "@/lib/admin/common";
import { loadDetail } from "@/lib/admin/masters";
import { KINDS, type Kind } from "@/lib/admin/masters-rules";

export function GET(req: NextRequest) {
  return adminRoute(req, async (actor) => {
    const kind = req.nextUrl.searchParams.get("kind") as Kind;
    if (!KINDS.includes(kind)) return bad();
    const detail = await loadDetail(kind, req.nextUrl.searchParams.get("id") ?? "", actor.clinicId);
    return detail ? done({ detail }) : bad();
  }, { roles: ["ADMIN", "RECEPTION"] });
}
