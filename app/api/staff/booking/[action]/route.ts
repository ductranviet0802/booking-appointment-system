// spec-screen: S02
// 代理予約 events: search (2), select (12), options (1, 6, 7: lists and frame grid), confirm (8–10). RECEPTION and ADMIN only (a DOCTOR → 403 SE091).
import { NextResponse, type NextRequest } from "next/server";
import { adminRoute } from "@/lib/admin/common";
import { confirmBooking, loadOptions, searchPatients, selectPatient } from "@/lib/staff/proxy";

const ACTIONS = { search: searchPatients, select: selectPatient, options: loadOptions, confirm: confirmBooking };

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  const fn = ACTIONS[action as keyof typeof ACTIONS];
  if (!fn) return NextResponse.json({ code: "SE090", params: {} }, { status: 404 });
  return adminRoute(req, fn, { roles: ["ADMIN", "RECEPTION"] });
}
