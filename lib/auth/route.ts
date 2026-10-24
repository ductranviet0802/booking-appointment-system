// Shared plumbing of the auth route handlers: CSRF check (N-SEC-04), JSON answers with 04 ids, cookies.
import type { Language } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import type { Result } from "@/lib/auth/service";
import { FLASH_COOKIE, GUARD_COOKIE, LANG_COOKIE, LANG_COOKIE_MAX_AGE, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { log } from "@/lib/logger";
import { clientIp, enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";

export const clientOf = (req: NextRequest) => ({
  ip: clientIp(req.headers), // X-Forwarded-For only behind TRUSTED_PROXY_HOPS proxies (lib/request-security)
  userAgent: req.headers.get("user-agent"),
});

export const cookieOf = (req: NextRequest, name: string) => req.cookies.get(name)?.value;
export const sessionTokenOf = (req: NextRequest) => cookieOf(req, SESSION_COOKIE);
export const guardIdOf = (req: NextRequest) => cookieOf(req, GUARD_COOKIE);

/** UI language of an anonymous request (F13-02 cookie), ja when absent or not an option */
export function uiLanguageOf(req: NextRequest): Language {
  const v = cookieOf(req, LANG_COOKIE);
  return v === "en" ? "EN" : v === "vi" ? "VI" : "JA";
}

export async function jsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

/** a cross-origin mutation → ER-02 (PE090); an unexpected error → ER-02 as well (P03 5-6) */
export function authRoute(req: NextRequest, fn: () => Promise<Response>) {
  return withRouteHandler(req, async () => {
    try {
      enforceSameOriginMutation(req);
    } catch {
      return NextResponse.json({ code: "PE090", params: {} }, { status: 403 });
    }
    try {
      return await fn();
    } catch (error) {
      log("error", "auth route failed", { path: req.nextUrl.pathname, error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ code: "PE090", params: {} }, { status: 500 });
    }
  });
}

/** sets the session cookie (and the language cookie for patients, F13-02) of a successful login / verification */
export function applyLogin<T extends NextResponse>(res: T, r: Result): T {
  if (!r.ok) return res;
  if (r.session) res.cookies.set(SESSION_COOKIE, r.session.token, sessionCookieOptions(r.session.expiresAt));
  if (r.language) {
    res.cookies.set(LANG_COOKIE, r.language.toLowerCase(), {
      httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: LANG_COOKIE_MAX_AGE,
    });
  }
  if (r.session) res.cookies.delete(GUARD_COOKIE);
  return res;
}

/** error → { code, params, errors? } with its status; success → { ok: true, … } */
export function answer(r: Result) {
  if (!r.ok) {
    return NextResponse.json({ code: r.code, params: r.params ?? {}, ...(r.errors && { errors: r.errors }) }, { status: r.status });
  }
  return applyLogin(NextResponse.json({ ok: true, ...r.body }), r);
}

/** reading 6: one 04 id for the next screen (FLASH_COOKIE, 60 s, readable by the page script that shows it) */
export function setFlash<T extends NextResponse>(res: T, id: string): T {
  res.cookies.set(FLASH_COOKIE, id, { path: "/", maxAge: 60, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}

/** 303 to an internal path (relative Location: correct behind the reverse proxy) */
export const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
