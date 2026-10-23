// P05 初回変更 mode (event 7): current staff session with must_change_password
import type { NextRequest } from "next/server";
import { answer, authRoute, clientOf, jsonBody, sessionTokenOf } from "@/lib/auth/route";
import { firstPasswordChange } from "@/lib/auth/service";

export function POST(req: NextRequest) {
  return authRoute(req, async () => {
    const b = await jsonBody(req);
    return answer(await firstPasswordChange({
      ...clientOf(req), sessionToken: sessionTokenOf(req), password: b.password, passwordConfirm: b.passwordConfirm,
    }));
  });
}
