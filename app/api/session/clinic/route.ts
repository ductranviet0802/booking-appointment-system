// _common event 9 (更新4): CF-03 clinic switch; outside 抽出4 → 403 SE091, nothing written
import type { NextRequest } from "next/server";
import { answer, authRoute, jsonBody, sessionTokenOf } from "@/lib/auth/route";
import { switchClinic } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => answer(await switchClinic(sessionTokenOf(req), (await jsonBody(req)).clinicId)));
}
