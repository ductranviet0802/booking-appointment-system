import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PATH_HEADER } from "@/lib/auth/path-header";
import type { RateLimitGroup } from "@/lib/config";
import { consumeRateLimitToken } from "@/lib/rate-limiter";

const BOT_PATTERNS = [
  /bot/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /python-requests/i,
  /go-http-client/i,
];

function getClientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
}

function isBotRequest(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") ?? "";
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function getRateLimitGroup(pathname: string): RateLimitGroup {
  if (pathname === "/api/health") {
    return "health";
  }

  if (pathname.startsWith("/api/auth/")) {
    return "auth";
  }

  if (pathname.startsWith("/api/bookings")) {
    return "booking";
  }

  return "public";
}

function shouldBypassBotFilter(pathname: string) {
  return pathname === "/api/health";
}

function rejectRequest(request: NextRequest, status: number, code: string, message: string, retryAfterSeconds?: number) {
  const isApiRequest = request.nextUrl.pathname.startsWith("/api/");
  const response = isApiRequest
    ? NextResponse.json({ code, message }, { status })
    : new NextResponse(message, {
        status,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });

  if (retryAfterSeconds) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }

  return response;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    pathname.startsWith("/_next")
    || pathname === "/favicon.ico"
    || pathname.includes(".segments/")
    || pathname.endsWith(".segment")
  ) {
    return NextResponse.next();
  }

  if (!pathname.startsWith("/api/")) {
    // P03 event 6/7: the NT-06 link opens /register?token=… and is handled before any redirect of the page
    if (pathname === "/register" && request.nextUrl.searchParams.has("token")) {
      const url = request.nextUrl.clone();
      url.pathname = "/api/auth/verify";
      return NextResponse.rewrite(url);
    }
    // the login-guard target of guardScreen (F9-03); always overwritten so a client cannot plant it
    const headers = new Headers(request.headers);
    headers.set(PATH_HEADER, pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  }

  if (!shouldBypassBotFilter(pathname) && isBotRequest(request)) {
    return rejectRequest(request, 403, "BOT_BLOCKED", "Request blocked.");
  }

  const group = getRateLimitGroup(pathname);
  const ip = getClientIp(request);
  const rateLimit = consumeRateLimitToken(ip, group);
  if (rateLimit.limited) {
    return rejectRequest(
      request,
      429,
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      rateLimit.retryAfterSeconds,
    );
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
