import { ApiError } from "@/lib/errors";
import type { NextRequest } from "next/server";

function sameOrigin(request: NextRequest, candidate: string | null) {
  if (!candidate) {
    return false;
  }

  try {
    const incoming = new URL(candidate);
    return incoming.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function enforceSameOriginMutation(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    if (!sameOrigin(request, origin)) {
      throw new ApiError(403, "FORBIDDEN_ORIGIN", "Nguồn request không hợp lệ.");
    }
    return;
  }

  const referer = request.headers.get("referer");
  if (!sameOrigin(request, referer)) {
    throw new ApiError(403, "FORBIDDEN_ORIGIN", "Nguồn request không hợp lệ.");
  }
}
