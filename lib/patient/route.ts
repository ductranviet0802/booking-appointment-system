// Route plumbing of the P06 / P07 APIs (reading 2): maintenance (withRouteHandler), cross-origin mutation → 403 PE090,
// no / invalid session → 401 PI013, a non-patient session → 403 SE091, an unexpected error → 500 PE090 (ER-02).
// The account always comes from the session, never from the request (reading 3).
import { NextResponse, type NextRequest } from "next/server";
import { getSession, requireOwnPatient } from "@/lib/auth/context";
import { answer, clientOf, jsonBody } from "@/lib/auth/route";
import type { Result } from "@/lib/auth/service";
import { log } from "@/lib/logger";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";

export type Actor = { accountId: string; sessionId: string; ip: string | null; now: Date };

export const fail = (status: number, code: string, params?: Record<string, string | number>): Result =>
  ({ ok: false, status, code, ...(params && { params }) });
export const tampered = () => fail(400, "PE090"); // a value the UI cannot produce → ER-02, nothing written
export const notOwn = () => fail(404, "PE091"); // F8-01: not a patient of the account → ER-01, nothing written

export async function actorOf(req: NextRequest): Promise<Actor | Response> {
  const s = await getSession();
  if (!s) return NextResponse.json({ code: "PI013", params: {} }, { status: 401 });
  if (s.account.role !== "PATIENT") return NextResponse.json({ code: "SE091", params: {} }, { status: 403 });
  return { accountId: s.account.id, sessionId: s.sessionId, ip: clientOf(req).ip, now: new Date() };
}

/** one P06 / P07 API: fn gets the actor and the JSON body; its Result is answered as the auth routes do */
export function patientRoute(req: NextRequest, fn: (actor: Actor, body: Record<string, unknown>) => Promise<Result | Response>) {
  return withRouteHandler(req, async () => {
    try {
      enforceSameOriginMutation(req);
    } catch {
      return NextResponse.json({ code: "PE090", params: {} }, { status: 403 });
    }
    try {
      const actor = await actorOf(req);
      if (actor instanceof Response) return actor;
      const r = await fn(actor, req.method === "GET" ? {} : await jsonBody(req));
      return r instanceof Response ? r : answer(r);
    } catch (error) {
      log("error", "patient route failed", { path: req.nextUrl.pathname, error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ code: "PE090", params: {} }, { status: 500 });
    }
  });
}

/** requireOwnPatient (F8-01) as a boolean: its ER-01 / ER-05 interrupt becomes false here, anything else is rethrown */
export async function ownPatient(patientId: unknown): Promise<boolean> {
  if (typeof patientId !== "string") return false;
  try {
    await requireOwnPatient(patientId);
    return true;
  } catch (e) {
    if (String((e as { digest?: unknown })?.digest ?? "").startsWith("NEXT_HTTP_ERROR_FALLBACK")) return false;
    throw e;
  }
}
