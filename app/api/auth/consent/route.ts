// CF-04 event 7 (_common 更新2): body { versions: { TERMS?: "<shown>", PRIVACY?: "<shown>" } }
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, guardIdOf, jsonBody, sessionTokenOf } from "@/lib/auth/route";
import { agreeConsents } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => answer(await agreeConsents({
    ...clientOf(req), sessionToken: sessionTokenOf(req), versions: (await jsonBody(req)).versions, guardId: guardIdOf(req),
  })));
}
