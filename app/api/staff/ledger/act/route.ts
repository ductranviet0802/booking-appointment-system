// spec-screen: S01
// Write events 4–7, 9, 15–16 (kind: checkin | undo | noshow | correct | cancel | adjust). RECEPTION and ADMIN only: a DOCTOR → 403 SE091.
import type { NextRequest } from "next/server";
import { adminRoute, bad } from "@/lib/admin/common";
import { adjustSend, cancelWrite, statusWrite } from "@/lib/staff/ledger";

export function POST(req: NextRequest) {
  return adminRoute(req, async (a, body) => {
    if (body.kind === "cancel") return cancelWrite(a, body);
    if (body.kind === "adjust") return adjustSend(a, body);
    return typeof body.kind === "string" ? statusWrite(a, body) : bad();
  }, { roles: ["ADMIN", "RECEPTION"] });
}
