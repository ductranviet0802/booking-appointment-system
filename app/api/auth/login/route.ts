// P02 events 4 / 5
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, guardIdOf, jsonBody } from "@/lib/auth/route";
import { login } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => {
    const b = await jsonBody(req);
    return answer(await login({ ...clientOf(req), email: b.email, password: b.password, guardId: guardIdOf(req) }));
  });
}
