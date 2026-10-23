// X4 lookup for P03 / P06 / P07 / S02 / S03: GET /api/postcode?code=1000005
// → { candidates } · 404 { code: "PE012" } (none) · 503 { code: "PE013" } (service unavailable) · 400 (not 7 digits)
import { NextResponse, type NextRequest } from "next/server";
import { lookupPostcode, normalizePostcode, X4UnavailableError } from "@/lib/adapters/x4-postcode";

export async function GET(request: NextRequest) {
  const code = normalizePostcode(request.nextUrl.searchParams.get("code") ?? "");
  if (!code) return NextResponse.json({ code: "PE012" }, { status: 400 });
  try {
    const candidates = await lookupPostcode(code);
    if (candidates.length === 0) return NextResponse.json({ code: "PE012" }, { status: 404 });
    return NextResponse.json({ candidates });
  } catch (e) {
    if (e instanceof X4UnavailableError) return NextResponse.json({ code: "PE013" }, { status: 503 });
    throw e;
  }
}
