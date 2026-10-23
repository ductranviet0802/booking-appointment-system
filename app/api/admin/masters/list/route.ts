// spec-screen: A03
// Events 1 / 13 and the reload after a write: the three lists and the choices (抽出2, 4, 6, 8). ADMIN and RECEPTION.
import type { NextRequest } from "next/server";
import { adminRoute, done } from "@/lib/admin/common";
import { loadLists } from "@/lib/admin/masters";

export function GET(req: NextRequest) {
  return adminRoute(req, async (actor) => done({ lists: await loadLists(actor.clinicId) }), { roles: ["ADMIN", "RECEPTION"] });
}
