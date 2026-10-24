// Shared plumbing of the admin write APIs (A03 events 5-11, A05 events 5-10): route wrapper with the access rules of the
// brief (SE090 / PI013 / SE091), the Actor, the MASTER_UPDATE audit row and the small answers.
import type { Prisma, Role } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/context";
import { answer, clientOf, jsonBody } from "@/lib/auth/route";
import { audit, type Result } from "@/lib/auth/service";
import type { FieldError } from "@/lib/auth/validate";
import { log } from "@/lib/logger";
import { enforceSameOriginMutation } from "@/lib/request-security";
import { withRouteHandler } from "@/lib/route-handler";

/** the logged-in administrator of a request; `clinicId` = sessions.clinic_id (never taken from the request) */
export type Actor = {
  accountId: string;
  role: Role;
  clinicId: string;
  allClinics: boolean;
  sessionId: string;
  ip: string | null;
  now: Date;
};

export type Db = Prisma.TransactionClient;

export const fail = (status: number, code: string, params?: Record<string, string | number>, errors?: FieldError[]): Result =>
  ({ ok: false, status, code, ...(params && { params }), ...(errors && { errors }) });
/** a value the UI cannot produce, an id that no longer exists (ER-02, SE090) */
export const bad = () => fail(400, "SE090");
export const fieldFail = (errors: FieldError[]) => fail(400, errors[0].code, errors[0].params, errors);
export const done = (body: Record<string, unknown> = {}): Result => ({ ok: true, body });

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

/**
 * One admin write route: maintenance 503 (withRouteHandler), cross-origin → 400 SE090, no / invalid session → 401 PI013,
 * role not ADMIN or must-change-password or a session clinic outside the CF-03 choices → 403 SE091 (nothing runs),
 * an unexpected error → 500 SE090 (ER-02).
 */
export function adminRoute(
  req: NextRequest,
  fn: (actor: Actor, body: Record<string, unknown>) => Promise<Result | Response>, // a Response (A06 download) is returned as is
  opts: { raw?: boolean; roles?: Role[] } = {},
) {
  const raw = opts.raw ?? false;
  const roles = opts.roles ?? ["ADMIN"];
  return withRouteHandler(req, async () => {
    if (req.method !== "GET") {
      try {
        enforceSameOriginMutation(req);
      } catch {
        return NextResponse.json({ code: "SE090", params: {} }, { status: 400 });
      }
    }
    const s = await getSession();
    if (!s) return NextResponse.json({ code: "PI013", params: {} }, { status: 401 });
    if (!roles.includes(s.account.role) || s.account.mustChangePassword || !s.clinicId || !s.clinics.some((c) => c.id === s.clinicId)) {
      return NextResponse.json({ code: "SE091", params: {} }, { status: 403 });
    }
    const actor: Actor = {
      accountId: s.account.id, role: s.account.role, clinicId: s.clinicId, allClinics: s.account.allClinics,
      sessionId: s.sessionId, ip: clientOf(req).ip, now: new Date(),
    };
    try {
      const r = await fn(actor, raw || req.method === "GET" ? {} : await jsonBody(req));
      return r instanceof Response ? r : answer(r);
    } catch (error) {
      log("error", "admin route failed", { path: req.nextUrl.pathname, error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ code: "SE090", params: {} }, { status: 500 });
    }
  });
}

/** 更新7 (A03) / 更新8 (A05): one MASTER_UPDATE row; a table whose columns did not change writes none. detail = column names only */
export async function masterAudit(tx: Db, a: Actor, targetType: string, targetId: string, columns: string[]) {
  if (columns.length === 0) return;
  await audit(tx, {
    accountId: a.accountId, role: a.role, action: "MASTER_UPDATE", ip: a.ip, now: a.now,
    targetType, targetId, clinicId: a.clinicId, detail: { columns },
  });
}

/** the columns (by their 03 names) whose value differs; arrays compare by content */
export function changedColumns(names: Record<string, string>, before: Record<string, unknown>, after: Record<string, unknown>) {
  const same = (x: unknown, y: unknown) => (Array.isArray(x) && Array.isArray(y) ? x.join("\u0000") === y.join("\u0000") : x === y);
  return Object.entries(names).filter(([k]) => !same(before[k], after[k])).map(([, col]) => col);
}
