// spec-screen: S01
// Event 13: 問診・備考 dialog (audited at every opening). A DOCTOR may open own bookings only.
import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { openDialog } from "@/lib/staff/ledger";

export function POST(req: NextRequest) {
  return adminRoute(req, openDialog, { roles: ["ADMIN", "RECEPTION", "DOCTOR"] });
}
