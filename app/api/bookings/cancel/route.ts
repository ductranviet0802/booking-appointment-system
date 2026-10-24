// spec-screen: P16
// POST { bookingId, version, reasonCode, reasonText, token } = PW001 はい (event 5): 200 PI050 · 400 { errors } (PE001 /
// PE003) · 400 PE090 (a value the dialog cannot produce, ER-02) · 404 PE091 (not the account's) · 409 PE044 / PE045 /
// PE041 / PE047. The same token twice (double submit) returns the first success and cancels once.
import type { NextRequest } from "next/server";
import { cancelMine } from "@/lib/patient/bookings";
import { patientRoute } from "@/lib/patient/route";

export function POST(req: NextRequest) {
  return patientRoute(req, (a, body) => cancelMine(a, body));
}
