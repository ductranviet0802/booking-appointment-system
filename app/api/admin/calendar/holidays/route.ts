// spec-screen: A01
// Event 6 (祝日を取り込む): starts the B3 manual run in the background and answers 202; the page polls ./state until the run ends.
import { NextResponse, type NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { startHolidayImport } from "@/lib/admin/calendar";

export async function POST(req: NextRequest) {
  const res = await adminRoute(req, (actor) => startHolidayImport(actor));
  return res.status === 200 ? NextResponse.json(await res.json(), { status: 202 }) : res;
}
