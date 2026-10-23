// P03 event 5. Body: the form fields of P03 §4 plus consentVersions { TERMS, PRIVACY } as shown (Q6).
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, jsonBody, uiLanguageOf } from "@/lib/auth/route";
import { register } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => answer(await register({ ...clientOf(req), body: await jsonBody(req), language: uiLanguageOf(req) })));
}
