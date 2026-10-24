// spec-screen: S01
// Events 1, 2, 12, 14, 17: the list for a condition. Read event: a DOCTOR may call it (own bookings only).
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { loadLedger } from "@/lib/staff/ledger";

export function POST(req: NextRequest) {
  return adminRoute(req, loadLedger, { roles: ["ADMIN", "RECEPTION", "DOCTOR"] });
}
