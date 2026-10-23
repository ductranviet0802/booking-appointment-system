// P04 event 3: always PI020
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, jsonBody } from "@/lib/auth/route";
import { requestPasswordReset } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => answer(await requestPasswordReset({ ...clientOf(req), email: (await jsonBody(req)).email })));
}
