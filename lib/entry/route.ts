// Route plumbing of the P11–P13 APIs: maintenance (withRouteHandler), cross-origin mutation → 403 PE090, a staff /
// doctor session → 403 SE091 (P11–P13 have no staff mode), an unexpected error → 500 PE090 (ER-02). The account and
// the draft always come from the session and the httpOnly cookie, never from the request body.
import { NextResponse, type NextRequest } from "next/server";
import { getSession, type SessionContext } from "@/lib/auth/context";
import { jsonBody } from "@/lib/auth/route";
import { DRAFT_COOKIE, draftCookieOptions } from "@/lib/booking/draft";
import { log } from "@/lib/logger";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";

export type Viewer = { session: SessionContext | null; draftId: string | undefined; owner: { accountId: string; sessionId: string } | null };

export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });
export const tampered = () => json(400, { code: "PE090", params: {} }); // a value the UI cannot produce → ER-02
export const notOwn = () => json(404, { code: "PE091", params: {} }); // another account's person / booking → ER-01
/** the screen is left for another one (T053 / T054–T056 / T103) */
export const go = (to: string, status = 200, extra: Record<string, unknown> = {}) => json(status, { ok: status === 200, to, ...extra });

/** one P11–P13 API; `login` = a patient session is required (401 PI013 without one) */
export function entryRoute(req: NextRequest, o: { login: boolean }, fn: (v: Viewer, body: Record<string, unknown>) => Promise<Response>) {
  return withRouteHandler(req, async () => {
    try {
      enforceSameOriginMutation(req);
    } catch {
      return json(403, { code: "PE090", params: {} });
    }
    try {
      const session = await getSession();
      if (session && session.account.role !== "PATIENT") return json(403, { code: "SE091", params: {} });
      if (o.login && !session) return json(401, { code: "PI013", params: {} });
      const v: Viewer = {
        session, draftId: req.cookies.get(DRAFT_COOKIE)?.value,
        owner: session ? { accountId: session.account.id, sessionId: session.sessionId } : null,
      };
      return await fn(v, req.method === "GET" ? {} : await jsonBody(req));
    } catch (error) {
      log("error", "booking entry route failed", { path: req.nextUrl.pathname, error: error instanceof Error ? error.message : String(error) });
      return json(500, { code: "PE090", params: {} });
    }
  });
}

export function withDraftCookie(res: NextResponse, id: string | null) {
  if (id) res.cookies.set(DRAFT_COOKIE, id, draftCookieOptions());
  else res.cookies.delete(DRAFT_COOKIE);
  return res;
}
