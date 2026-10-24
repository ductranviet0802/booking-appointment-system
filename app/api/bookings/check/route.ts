// spec-screen: P16
// POST { bookingId, version }: 抽出3 before P11 change mode (event 2) and before PW001 (event 4) — status → deadline →
// version; 200 { ok } or 409 { code: PE044 | PE045 | PE041 | PE047 }. Not the account's booking → 404 PE091. Writes nothing.
import { NextResponse, type NextRequest } from "next/server";
import { recheck } from "@/lib/patient/bookings";
import { fail, patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, async (a, body) => {
    if (typeof body.bookingId !== "string" || !Number.isInteger(body.version)) return fail(400, "PE090");
    const code = await recheck(a.accountId, body.bookingId, body.version as number, a.now);
    if (code === "PE091") return fail(404, code);
    return code ? fail(409, code) : NextResponse.json({ ok: true });
  });
}
