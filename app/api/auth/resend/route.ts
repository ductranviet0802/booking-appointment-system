// P02 event 8 / P03 event 8: always PI001. Body { email, screen: "P02" | "P03" }.
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, jsonBody } from "@/lib/auth/route";
import { resendVerification } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => {
    const b = await jsonBody(req);
    return answer(await resendVerification({ ...clientOf(req), email: b.email, screen: b.screen }));
  });
}
