// spec-screen: P15
// GET ?tab=upcoming|past|canceled&offset=n: one page (20 rows) of the session account's bookings with the tab counts
// (events 2 and 5). The account comes from the session only; a value the screen cannot send → 400 PE090 (ER-02).
import { NextResponse, type NextRequest } from "next/server";
import { listBookings, MAX_OFFSET, PAGE_SIZE, TABS, type Tab } from "@/lib/patient/bookings";
import { fail, patientRoute } from "@/lib/patient/route";
import { getLanguage } from "@/lib/frame/data";

export function GET(req: NextRequest) {
  return patientRoute(req, async (a) => {
    const tab = req.nextUrl.searchParams.get("tab") ?? "";
    const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
    if (!(TABS as readonly string[]).includes(tab) || !Number.isInteger(offset) || offset < 0 || offset % PAGE_SIZE !== 0 || offset > MAX_OFFSET) {
      return fail(400, "PE090");
    }
    return NextResponse.json(await listBookings(a.accountId, tab as Tab, offset, await getLanguage(), a.now));
  });
}
