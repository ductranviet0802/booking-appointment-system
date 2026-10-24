import { ApiError } from "@/lib/errors";
import type { NextRequest } from "next/server";

// Behind a reverse proxy (Caddy) the app is reached over plain HTTP internally
// even though the public site is HTTPS, so `request.nextUrl.origin` reports
// the wrong protocol/host. Reconstruct the public-facing origin from
// X-Forwarded-Proto/Host (set by Caddy) when present. Safe to trust here
// because the app container is not reachable except via the proxy on the
// shared Docker network (no public host port).
function currentOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");
  const host = forwardedHost || request.nextUrl.host;
  return `${protocol}://${host}`;
}

const IP = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f]*:[0-9a-f:.]*$/i;

/**
 * The client address (rate limits, audit_logs.ip). X-Forwarded-For is trusted only when the deployment says how many
 * proxies append to it (TRUSTED_PROXY_HOPS; default 0 = not trusted): with N hops the N-th address from the right is the
 * one the outermost trusted proxy saw. No usable address → null; callers then skip the per-IP limit instead of sharing
 * one "unknown" bucket that a single client could fill for everyone (the per-address limits still apply).
 */
export function clientIp(headers: Headers): string | null {
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops < 1) return null;
  const list = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = list[list.length - hops];
  return ip && IP.test(ip) ? ip : null;
}

function sameOrigin(request: NextRequest, candidate: string | null) {
  if (!candidate) {
    return false;
  }

  try {
    const incoming = new URL(candidate);
    return incoming.origin === currentOrigin(request);
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
