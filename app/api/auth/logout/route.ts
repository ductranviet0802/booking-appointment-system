import { clearAuthCookie } from "@/lib/auth";
import { ok } from "@/lib/http";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return withRouteHandler(request, async () => {
    enforceSameOriginMutation(request);
    const response = ok({ success: true });
    clearAuthCookie(response);
    return response;
  });
}
