// spec-screen: S01
// Event 3: 予約番号 search within the staff's clinics (switches the session clinic when needed).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { getSession } from "@/lib/auth/context";
import { searchBooking } from "@/lib/staff/ledger";

export function POST(req: NextRequest) {
  return adminRoute(req, async (a, body) => searchBooking(a, ((await getSession())?.clinics ?? []).map((c) => c.id), body), {
    roles: ["ADMIN", "RECEPTION", "DOCTOR"],
  });
}
